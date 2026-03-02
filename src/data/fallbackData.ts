export const FALLBACK_PROVINCES = {
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "properties": { "name": "Madrid" }, "geometry": { "type": "Polygon", "coordinates": [[[ -3.8, 40.5 ], [ -3.5, 40.5 ], [ -3.5, 40.3 ], [ -3.8, 40.3 ], [ -3.8, 40.5 ]]] } },
    { "type": "Feature", "properties": { "name": "Barcelona" }, "geometry": { "type": "Polygon", "coordinates": [[[ 2.1, 41.5 ], [ 2.3, 41.5 ], [ 2.3, 41.3 ], [ 2.1, 41.3 ], [ 2.1, 41.5 ]]] } }
  ]
};

export const FALLBACK_MUNICIPALITIES = [
  { "nombre": "Madrid", "provincia": "Madrid", "latitud": 40.4168, "longitud": -3.7038, "poblacion": 3305408 },
  { "nombre": "Barcelona", "provincia": "Barcelona", "latitud": 41.3851, "longitud": 2.1734, "poblacion": 1636762 },
  { "nombre": "Valencia", "provincia": "Valencia", "latitud": 39.4699, "longitud": -0.3763, "poblacion": 800215 },
  { "nombre": "Sevilla", "provincia": "Sevilla", "latitud": 37.3891, "longitud": -5.9845, "poblacion": 681998 },
  { "nombre": "Zaragoza", "provincia": "Zaragoza", "latitud": 41.6488, "longitud": -0.8891, "poblacion": 673010 },
  { "nombre": "Málaga", "provincia": "Málaga", "latitud": 36.7213, "longitud": -4.4214, "poblacion": 578460 },
  { "nombre": "Murcia", "provincia": "Murcia", "latitud": 37.9922, "longitud": -1.1307, "poblacion": 459403 },
  { "nombre": "Palma", "provincia": "Islas Baleares", "latitud": 39.5696, "longitud": 2.6502, "poblacion": 422587 },
  { "nombre": "Las Palmas de Gran Canaria", "provincia": "Las Palmas", "latitud": 28.1235, "longitud": -15.4363, "poblacion": 379925 },
  { "nombre": "Bilbao", "provincia": "Vizcaya", "latitud": 43.2630, "longitud": -2.9350, "poblacion": 346843 }
];
