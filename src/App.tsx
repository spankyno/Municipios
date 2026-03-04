import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { MapPin, RefreshCw, Info, Navigation2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { FALLBACK_PROVINCES, FALLBACK_MUNICIPALITIES } from './data/fallbackData';

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
  // Local paths (trying multiple variations)
  PROVINCES_LOCAL: ['/data/provinces.json', './data/provinces.json', 'data/provinces.json'],
  MUNICIPIOS_LOCAL: ['/data/municipalities.json', './data/municipalities.json', 'data/municipalities.json'],
  // Remote fallbacks - Using more reliable sources
  PROVINCES: 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/master/public/data/spain-provinces.geojson',
  PROVINCES_FALLBACK: 'https://cdn.jsdelivr.net/gh/deldar182/geojson-spain@master/provincias.json',
  MUNICIPIOS: 'https://raw.githubusercontent.com/draco-at-git/municipios-espanoles/master/municipios.json',
  MUNICIPIOS_FALLBACK: 'https://cdn.jsdelivr.net/gh/frontid/municipios-espanoles@master/municipios.json',
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
  const [dataStatus, setDataStatus] = useState<{
    provinces: 'loading' | 'ok' | 'error' | 'fallback';
    municipalities: 'loading' | 'ok' | 'error' | 'fallback';
    details: string[];
  }>({
    provinces: 'loading',
    municipalities: 'loading',
    details: []
  });

  const addDetail = (msg: string) => {
    setDataStatus(prev => ({ ...prev, details: [...prev.details, msg] }));
  };

  // Helper to fetch with multiple fallbacks, proxies and retries
  const fetchWithProxy = async (url: string, retries = 0) => {
    const attempt = async (targetUrl: string): Promise<any> => {
      addDetail(`🔍 Solicitando: ${targetUrl}`);
      try {
        const response = await fetch(targetUrl);
        if (response.ok) {
          const data = await response.json();
          addDetail(`✅ Recibido: ${targetUrl}`);
          return data;
        }
        addDetail(`❌ Error HTTP ${response.status}: ${targetUrl}`);
      } catch (e) {
        addDetail(`❌ Error de red: ${targetUrl}`);
      }

      // Proxy as second attempt for remote URLs
      if (targetUrl.startsWith('http')) {
        try {
          addDetail(`🌐 Intentando vía proxy: ${targetUrl}`);
          const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
          const response = await fetch(proxyUrl);
          if (response.ok) {
            const data = await response.json();
            if (data.contents) {
              addDetail(`✅ Recibido vía proxy: ${targetUrl}`);
              return JSON.parse(data.contents);
            }
          }
        } catch (e) {
          addDetail(`❌ Proxy fallido para ${targetUrl}`);
        }
      }
      
      throw new Error(`Failed to fetch ${targetUrl}`);
    };

    for (let i = 0; i <= retries; i++) {
      try {
        return await attempt(url);
      } catch (err) {
        if (i === retries) throw err;
        await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
      }
    }
  };

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        console.log(`Container resized: ${width}x${height}`);
        setDimensions({ width, height });
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      addDetail("Iniciando carga de datos...");
      try {
        let provData;
        let provSource: 'ok' | 'fallback' = 'fallback';
        
        // Try local paths first
        const localProvPaths = ['/data/provinces.json', 'data/provinces.json', './data/provinces.json'];
        for (const path of localProvPaths) {
          try {
            addDetail(`Probando ruta local provincias: ${path}`);
            const response = await fetch(path);
            if (response.ok) {
              provData = await response.json();
              addDetail(`✅ Provincias cargadas desde: ${path}`);
              provSource = 'ok';
              break;
            }
          } catch (e) {
            addDetail(`❌ Falló ruta local: ${path}`);
          }
        }

        // If local failed, try remote
        if (!provData) {
          try {
            addDetail(`Probando ruta remota provincias: ${CONFIG.PROVINCES}`);
            provData = await fetchWithProxy(CONFIG.PROVINCES);
            provSource = 'ok';
          } catch {
            try {
              addDetail(`Probando ruta remota fallback provincias: ${CONFIG.PROVINCES_FALLBACK}`);
              provData = await fetchWithProxy(CONFIG.PROVINCES_FALLBACK);
              provSource = 'ok';
            } catch {
              addDetail(`⚠️ Usando datos de provincias de emergencia (hardcoded)`);
              provData = FALLBACK_PROVINCES;
              provSource = 'fallback';
            }
          }
        }
        
        let features: any[] = [];
        if (provData) {
          if (Array.isArray(provData.features)) {
            features = provData.features;
          } else if (Array.isArray(provData)) {
            features = provData;
          } else if (provData.type === 'FeatureCollection' && Array.isArray(provData.features)) {
            features = provData.features;
          }
        }
        
        if (features.length === 0) {
          addDetail("⚠️ No se encontraron provincias, usando fallback");
          features = FALLBACK_PROVINCES.features;
          provSource = 'fallback';
        }

        addDetail(`✅ ${features.length} provincias cargadas`);
        setProvinces(features);
        setDataStatus(prev => ({ ...prev, provinces: provSource }));

        let muniData;
        let muniSource: 'ok' | 'fallback' = 'fallback';
        
        // Try local paths first
        const localMuniPaths = ['/data/municipalities.json', 'data/municipalities.json', './data/municipalities.json'];
        for (const path of localMuniPaths) {
          try {
            addDetail(`Probando ruta local municipios: ${path}`);
            const response = await fetch(path);
            if (response.ok) {
              muniData = await response.json();
              addDetail(`✅ Municipios cargados desde: ${path}`);
              muniSource = 'ok';
              break;
            }
          } catch (e) {
            addDetail(`❌ Falló ruta local: ${path}`);
          }
        }

        if (!muniData) {
          try {
            addDetail(`Probando ruta remota municipios: ${CONFIG.MUNICIPIOS}`);
            muniData = await fetchWithProxy(CONFIG.MUNICIPIOS);
            muniSource = 'ok';
          } catch {
            try {
              addDetail(`Probando ruta remota fallback municipios: ${CONFIG.MUNICIPIOS_FALLBACK}`);
              muniData = await fetchWithProxy(CONFIG.MUNICIPIOS_FALLBACK);
              muniSource = 'ok';
            } catch {
              addDetail(`⚠️ Usando datos de municipios de emergencia (hardcoded)`);
              muniData = FALLBACK_MUNICIPALITIES;
              muniSource = 'fallback';
            }
          }
        }

        setDataStatus(prev => ({ ...prev, municipalities: muniSource }));

        // Normalize data
        let rawMuni: any[] = [];
        if (Array.isArray(muniData)) {
          rawMuni = muniData;
        } else if (muniData && typeof muniData === 'object') {
          rawMuni = muniData.features || muniData.municipios || muniData.data || Object.values(muniData).find(v => Array.isArray(v)) || [];
        }
        
        if (rawMuni.length === 0) {
          addDetail("⚠️ Lista de municipios vacía, usando fallback");
          rawMuni = FALLBACK_MUNICIPALITIES;
        }

        const normalizedMuni = rawMuni.map((m: any) => {
          // GeoJSON Feature
          if (m.type === 'Feature' || (m.properties && m.geometry)) {
            const props = m.properties || {};
            const geom = m.geometry || {};
            const coords = geom.coordinates || [0, 0];
            return {
              nombre: props.ETIQUETA || props.nombre || props.municipio || props.name || "Desconocido",
              provincia: props.provincia || props.province || "Desconocida",
              latitud: parseFloat(coords[1] || 0),
              longitud: parseFloat(coords[0] || 0),
              poblacion: parseInt(props.POBLACION || props.poblacion || props.pop || props.population || 0)
            };
          }
          // Plain object
          return {
            nombre: m.nombre || m.municipio || m.name || m.ETIQUETA || "Desconocido",
            provincia: m.provincia || m.province || "Desconocida",
            latitud: parseFloat(m.latitud || m.lat || m.latitude || 0),
            longitud: parseFloat(m.longitud || m.lon || m.lng || m.longitude || 0),
            poblacion: parseInt(m.poblacion || m.pop || m.population || m.POBLACION || 0)
          };
        }).filter((m: any) => !isNaN(m.latitud) && !isNaN(m.longitud) && (m.latitud !== 0 || m.longitud !== 0));

        if (normalizedMuni.length === 0) {
          addDetail("⚠️ No se pudieron procesar los municipios, usando fallback");
          setMunicipalities(FALLBACK_MUNICIPALITIES);
        } else {
          addDetail(`✅ ${normalizedMuni.length} municipios listos`);
          setMunicipalities(normalizedMuni);
        }
        
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
    if (municipalities.length > 0 && !targetMunicipality) {
      const filtered = municipalities.filter((m: Municipality) => 
        m.poblacion >= DIFFICULTY_CONFIG[difficulty].min && m.poblacion <= DIFFICULTY_CONFIG[difficulty].max
      );
      const randomMuni = filtered[Math.floor(Math.random() * filtered.length)] || municipalities[0];
      setTargetMunicipality(randomMuni);
    }
  }, [municipalities, difficulty]);


  useEffect(() => {
    console.log(`Current provinces count: ${provinces.length}`);
    if (provinces.length > 0) {
      console.log('Sample province:', provinces[0]);
    }
  }, [provinces]);

  useEffect(() => {
    try {
      if (!svgRef.current || !Array.isArray(provinces) || provinces.length === 0 || dimensions.width === 0) {
        console.log('Skipping render:', { 
          hasSvg: !!svgRef.current, 
          provIsArray: Array.isArray(provinces),
          provCount: provinces?.length, 
          width: dimensions.width 
        });
        return;
      }

      const { width, height } = dimensions;
      console.log(`Rendering map: ${width}x${height}, provinces: ${provinces.length}`);
      
      const svg = d3.select(svgRef.current);
      svg.selectAll(".map-layer").remove();

      const proj = d3.geoMercator();
      
      const featureCollection = { type: 'FeatureCollection', features: provinces };
      console.log('Fitting size for feature collection:', featureCollection);
      
      proj.fitSize([width, height], featureCollection as any);

      setProjection(() => proj);

      const path = d3.geoPath().projection(proj);

      const g = svg.append("g").attr("class", "map-layer");

      // Draw provinces
      if (Array.isArray(provinces) && provinces.length > 0) {
        const validProvinces = provinces.filter(f => f && f.geometry);
        console.log(`Drawing ${validProvinces.length} valid provinces`);
        
        const colorScale = d3.scaleOrdinal(d3.schemePastel1);

        g.selectAll("path")
          .data(validProvinces)
          .enter()
          .append("path")
          .attr("d", path as any)
          .attr("class", "province")
          .attr("fill", (d, i) => colorScale(i.toString()))
          .attr("stroke", "#334155")
          .attr("stroke-width", 0.5)
          .attr("stroke-linejoin", "round")
          .on("mouseover", function() {
            d3.select(this).attr("fill-opacity", 0.8);
          })
          .on("mouseout", function() {
            d3.select(this).attr("fill-opacity", 1);
          })
          .on("click", (event) => {
            event.stopPropagation();
            const [x, y] = d3.pointer(event);
            const coords = proj.invert!([x, y]);
            if (coords && targetMunicipality) {
              handleMapClick(coords[1], coords[0], x, y);
            }
          });
      } else {
        console.warn("No provinces to draw");
      }

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
    } catch (err) {
      console.error("Error rendering map:", err);
      setError("Error al dibujar el mapa. Por favor, recarga la página.");
    }

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
          <div className="mt-8 bg-white/80 p-4 rounded-lg shadow border border-stone-200 max-w-xs text-[10px] font-mono overflow-auto max-h-48">
            <h3 className="font-bold mb-2 border-b pb-1">Log de carga:</h3>
            <div className="space-y-1">
              {Array.isArray(dataStatus.details) && dataStatus.details.map((d, i) => (
                <div key={i} className="border-l-2 border-blue-500 pl-2">{d}</div>
              ))}
            </div>
          </div>
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

        {/* Data Warning */}
        {(dataStatus.provinces === 'fallback' || dataStatus.municipalities === 'fallback') && (
          <div className="hidden md:flex items-center gap-2 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg text-[10px] text-amber-700">
            <Info className="w-3 h-3" />
            <span>Usando datos de emergencia. Sube <b>municipalities.json</b> a /public/data/</span>
          </div>
        )}

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
      <main ref={containerRef} className="flex-1 relative bg-[#0ea5e9] cursor-crosshair border-8 border-stone-300 m-4 rounded-[2rem] overflow-hidden shadow-2xl">
        <div className="absolute top-4 right-4 z-20 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold text-stone-500 shadow-sm border border-stone-200">
          Provincias: {provinces.length} | Municipios: {municipalities.length}
        </div>
        <svg 
          ref={svgRef} 
          className="w-full h-full border-4 border-white/20 rounded-[1.5rem]"
          style={{ filter: 'drop-shadow(0 10px 15px rgba(0,0,0,0.2))' }}
        >
          {/* Sea background */}
          <rect width="100%" height="100%" fill="#bae6fd" />
          
          {provinces.length === 0 && (
            <text x="50%" y="50%" textAnchor="middle" fill="#0369a1" className="text-sm font-bold">
              Cargando mapa base...
            </text>
          )}
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
