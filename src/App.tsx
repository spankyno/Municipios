import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { MapPin, RefreshCw, Info, Navigation2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Municipality {
  nombre: string;
  provincia: string;
  latitud: number;
  longitud: number;
  poblacion: number;
}

type Difficulty = 'easy' | 'medium' | 'hard';

const DIFFICULTY_CONFIG = {
  easy: { label: 'Fácil', min: 20000, max: Infinity, description: '> 20.000 hab.' },
  medium: { label: 'Medio', min: 500, max: 20000, description: '500 - 20.000 hab.' },
  hard: { label: 'Difícil', min: 0, max: 500, description: '< 500 hab.' },
};

interface ProvinceFeature extends GeoJSON.Feature<GeoJSON.Geometry, any> {}

const CONFIG = {
  PROVINCES: 'https://cdn.jsdelivr.net/gh/deldar182/geojson-spain@master/provincias.json',
  PROVINCES_FALLBACK: 'https://cdn.jsdelivr.net/gh/codeforgermany/click_that_hood@master/public/data/spain-provinces.geojson',
  MUNICIPIOS: 'https://cdn.jsdelivr.net/gh/draco-at-git/municipios-espanoles@master/municipios.json',
  MUNICIPIOS_FALLBACK: 'https://cdn.jsdelivr.net/gh/frontid/municipios-espanoles@master/municipios.json',
};

// Helper to fetch with multiple fallbacks, proxies and retries
const fetchWithProxy = async (url: string, retries = 2) => {
  const attempt = async (targetUrl: string): Promise<any> => {
    // Strategy 1: Direct fetch
    try {
      const response = await fetch(targetUrl);
      if (response.ok) return await response.json();
    } catch (e) {
      console.warn(`Direct fetch failed for ${targetUrl}`);
    }

    // Strategy 2: AllOrigins Proxy
    try {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
      const response = await fetch(proxyUrl);
      if (response.ok) {
        const data = await response.json();
        if (data.contents) {
          return JSON.parse(data.contents);
        }
      }
    } catch (e) {
      console.warn(`Proxy failed for ${targetUrl}`);
    }
    
    throw new Error("Fetch failed");
  };

  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt(url);
    } catch (err) {
      if (i === retries) throw err;
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
};

// Haversine formula to calculate distance between two points in km
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

export default function App() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [provinces, setProvinces] = useState<ProvinceFeature[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [score, setScore] = useState<number | null>(null);
  const [totalScore, setTotalScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [targetMunicipality, setTargetMunicipality] = useState<Municipality | null>(null);
  const [userClick, setUserClick] = useState<{ lat: number; lon: number; x: number; y: number } | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projection, setProjection] = useState<d3.GeoProjection | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        setDimensions({ width, height });
      }
    });

    if (svgRef.current) {
      observer.observe(svgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        let provData;
        try {
          provData = await fetchWithProxy(CONFIG.PROVINCES);
        } catch {
          provData = await fetchWithProxy(CONFIG.PROVINCES_FALLBACK);
        }
        
        const features = Array.isArray(provData.features) 
          ? provData.features 
          : (Array.isArray(provData) ? provData : []);
        
        if (features.length === 0) throw new Error("El mapa de provincias está vacío");
        setProvinces(features);

        let muniData;
        try {
          muniData = await fetchWithProxy(CONFIG.MUNICIPIOS);
        } catch {
          muniData = await fetchWithProxy(CONFIG.MUNICIPIOS_FALLBACK);
        }

        // Normalize data
        const normalizedMuni = muniData.map((m: any) => ({
          nombre: m.nombre || m.municipio || m.name,
          provincia: m.provincia || m.province,
          latitud: parseFloat(m.latitud || m.lat || m.latitude),
          longitud: parseFloat(m.longitud || m.lon || m.lng || m.longitude),
          poblacion: parseInt(m.poblacion || m.pop || m.population || 0)
        })).filter((m: any) => !isNaN(m.latitud) && !isNaN(m.longitud));

        setMunicipalities(normalizedMuni);
        
        const filtered = normalizedMuni.filter((m: Municipality) => 
          m.poblacion >= DIFFICULTY_CONFIG['easy'].min && m.poblacion <= DIFFICULTY_CONFIG['easy'].max
        );
        const randomMuni = filtered[Math.floor(Math.random() * filtered.length)] || normalizedMuni[0];
        setTargetMunicipality(randomMuni);
        setLoading(false);
      } catch (err: any) {
        console.error("Error loading map data:", err);
        setError(err.message || "Error desconocido al cargar los datos");
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    if (!svgRef.current || provinces.length === 0 || dimensions.width === 0) return;

    const { width, height } = dimensions;
    const svg = d3.select(svgRef.current);
    svg.selectAll(".map-layer").remove();

    const proj = d3.geoMercator();
    proj.fitSize([width, height], { type: 'FeatureCollection', features: provinces } as any);

    setProjection(() => proj);

    const path = d3.geoPath().projection(proj);

    const g = svg.append("g").attr("class", "map-layer");

    // Draw provinces
    g.selectAll("path")
      .data(provinces)
      .enter()
      .append("path")
      .attr("d", path as any)
      .attr("class", "province")
      .on("click", (event) => {
        event.stopPropagation();
        const [x, y] = d3.pointer(event);
        const coords = proj.invert!([x, y]);
        if (coords && targetMunicipality) {
          handleMapClick(coords[1], coords[0], x, y);
        }
      });

    // Handle click on the background
    svg.on("click", (event) => {
      if (event.target.tagName === 'svg') {
        const [x, y] = d3.pointer(event);
        const coords = proj.invert!([x, y]);
        if (coords && targetMunicipality) {
          handleMapClick(coords[1], coords[0], x, y);
        }
      }
    });

  }, [provinces, targetMunicipality, dimensions]);

  const handleMapClick = (lat: number, lon: number, x: number, y: number) => {
    if (!targetMunicipality || distance !== null) return;

    setUserClick({ lat, lon, x, y });
    const dist = calculateDistance(lat, lon, targetMunicipality.latitud, targetMunicipality.longitud);
    setDistance(dist);

    // Calculate score: 1000 points max, decreases with distance
    // 0 points at 500km
    const points = Math.max(0, Math.round(1000 * Math.exp(-dist / 100)));
    setScore(points);
    setTotalScore(prev => prev + points);
    setAttempts(prev => prev + 1);
  };

  const resetGame = (newDifficulty?: Difficulty) => {
    const diff = newDifficulty || difficulty;
    if (newDifficulty) setDifficulty(newDifficulty);

    const filtered = municipalities.filter((m: Municipality) => 
      m.poblacion >= DIFFICULTY_CONFIG[diff].min && m.poblacion <= DIFFICULTY_CONFIG[diff].max
    );
    
    if (filtered.length > 0) {
      const randomMuni = filtered[Math.floor(Math.random() * filtered.length)];
      setTargetMunicipality(randomMuni);
    }
    
    setUserClick(null);
    setDistance(null);
    setScore(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-stone-50">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-stone-400" />
          <p className="text-stone-500 font-medium">Cargando datos geográficos...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-stone-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-stone-200 max-w-md text-center">
          <div className="bg-red-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
            <Info className="w-6 h-6 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-stone-900 mb-2">Error al cargar el juego</h2>
          <p className="text-stone-500 mb-6">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-stone-900 text-white font-bold py-3 rounded-xl hover:bg-stone-800 transition-colors"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden flex flex-col">
      {/* Header */}
      <header className="h-20 bg-white border-b border-stone-200 flex items-center justify-between px-8 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-100 p-2 rounded-lg">
            <Navigation2 className="w-6 h-6 text-emerald-600 fill-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-stone-900">GeoMunicipios</h1>
            <p className="text-xs text-stone-500 font-medium uppercase tracking-wider">España</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Difficulty Selector */}
          <div className="flex bg-stone-100 p-1 rounded-xl border border-stone-200">
            {(Object.keys(DIFFICULTY_CONFIG) as Difficulty[]).map((d) => (
              <button
                key={d}
                onClick={() => resetGame(d)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  difficulty === d 
                    ? 'bg-white text-stone-900 shadow-sm' 
                    : 'text-stone-400 hover:text-stone-600'
                }`}
              >
                {DIFFICULTY_CONFIG[d].label}
              </button>
            ))}
          </div>

          {/* Score Board */}
          <div className="flex items-center gap-6 px-6 py-2 bg-stone-50 rounded-xl border border-stone-200">
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">Puntos</span>
              <span className="text-lg font-black text-stone-900">{totalScore.toLocaleString()}</span>
            </div>
            <div className="w-px h-8 bg-stone-200" />
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">Intentos</span>
              <span className="text-lg font-black text-stone-900">{attempts}</span>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {targetMunicipality && (
              <motion.div
                key={targetMunicipality.nombre}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="bg-stone-900 text-white px-6 py-2 rounded-full shadow-lg flex items-center gap-3"
              >
                <span className="text-stone-400 text-xs font-bold uppercase tracking-widest">Busca:</span>
                <span className="text-lg font-bold">{targetMunicipality.nombre}</span>
                <span className="text-stone-400 text-sm">({targetMunicipality.provincia})</span>
              </motion.div>
            )}
          </AnimatePresence>
          
          <button 
            onClick={resetGame}
            className="p-2 hover:bg-stone-100 rounded-full transition-colors text-stone-600"
            title="Nuevo municipio"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Map Area */}
      <main className="flex-1 relative bg-stone-100 cursor-crosshair">
        <svg 
          ref={svgRef} 
          className="w-full h-full"
        >
          {/* D3 renders here */}
          {projection && targetMunicipality && userClick && (
            <g>
              {/* Target Point */}
              {(() => {
                const [tx, ty] = projection([targetMunicipality.longitud, targetMunicipality.latitud]) || [0, 0];
                return (
                  <>
                    <motion.line
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      x1={userClick.x}
                      y1={userClick.y}
                      x2={tx}
                      y2={ty}
                      className="distance-line"
                    />
                    <circle cx={tx} cy={ty} r={6} className="municipality-dot" />
                    <circle cx={userClick.x} cy={userClick.y} r={6} className="click-dot" />
                  </>
                );
              })()}
            </g>
          )}
        </svg>

        {/* Distance Result Overlay */}
        <AnimatePresence>
          {distance !== null && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-white p-6 rounded-2xl shadow-2xl border border-stone-200 flex flex-col items-center gap-4 min-w-[350px]"
            >
              <div className="flex w-full justify-between items-center gap-8">
                <div className="text-center flex-1">
                  <p className="text-stone-500 text-[10px] font-bold uppercase tracking-widest mb-1">Distancia</p>
                  <p className="text-3xl font-black text-stone-900">
                    {distance.toFixed(1)} <span className="text-xl font-bold text-stone-400">km</span>
                  </p>
                </div>
                
                <div className="w-px h-12 bg-stone-100" />

                <div className="text-center flex-1">
                  <p className="text-stone-500 text-[10px] font-bold uppercase tracking-widest mb-1">Puntuación</p>
                  <motion.p 
                    initial={{ scale: 1.5, color: '#10b981' }}
                    animate={{ scale: 1, color: '#1c1917' }}
                    className="text-3xl font-black"
                  >
                    +{score}
                  </motion.p>
                </div>
              </div>
              
              <div className="w-full h-px bg-stone-100" />
              
              <div className="w-full flex flex-col gap-2">
                <p className="text-center text-[10px] text-stone-400 font-medium">
                  Población: {targetMunicipality?.poblacion.toLocaleString()} habitantes
                </p>
                <button
                  onClick={() => resetGame()}
                  className="w-full bg-stone-900 hover:bg-stone-800 text-white font-bold py-3 rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Siguiente municipio
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Instructions */}
        {!userClick && (
          <div className="absolute top-6 left-6 bg-white/80 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-sm pointer-events-none">
            <div className="flex items-center gap-2 text-stone-700 mb-1">
              <Info className="w-4 h-4" />
              <span className="text-sm font-bold">Instrucciones</span>
            </div>
            <p className="text-xs text-stone-500 leading-relaxed">
              Haz click en el mapa donde creas que se sitúa el municipio indicado arriba.
            </p>
          </div>
        )}
      </main>

      {/* Footer / Credits */}
      <footer className="h-10 bg-stone-50 border-t border-stone-200 flex items-center justify-between px-8 text-[10px] text-stone-400 font-medium uppercase tracking-widest">
        <span>Datos: IGN España & Javier Arce</span>
        <div className="flex gap-4">
          <span>Municipios cargados: {municipalities.length}</span>
          <span>Provincias: {provinces.length}</span>
        </div>
      </footer>
    </div>
  );
}
