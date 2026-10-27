// The airports the radar can watch, chosen in SETUP. Each one centres the
// live feed and the map; coastline, lakes and rivers come from coastline.js
// (Øresund) or maps.js, everything else is here. Points are [name, lon, lat,
// label side]; runways [lat1, lon1, lat2, lon2], placed by hand from charts
// (Kastrup and Heathrow closely, the others roughly). `scale` zooms the
// radar in from the usual 470 px per degree of latitude.
(function () {
  'use strict';

  // the Øresund map Kastrup and Malmö share
  var ORESUND = {
    coast: function () { return window.COASTLINE; },
    places: [
      ['KØBENHAVN', 12.568, 55.676, 'r'], ['MALMÖ', 13.003, 55.605, 'r'],
      ['HELSINGØR', 12.592, 56.036, 'l'], ['HELSINGBORG', 12.694, 56.046, 'r'],
      ['ROSKILDE', 12.080, 55.642, 'l'], ['KØGE', 12.182, 55.458, 'l'],
      ['LUND', 13.191, 55.705, 'r'], ['TRELLEBORG', 13.157, 55.375, 'r'],
      ['LANDSKRONA', 12.830, 55.870, 'r'], ['HILLERØD', 12.310, 55.930, 'l'],
      ['YSTAD', 13.820, 55.430, 'r'], ['NÆSTVED', 11.760, 55.230, 'r']
    ],
    // rough Øresund median line, Kattegat to the Baltic
    borders: function () {
      return [[[12.50, 56.30], [12.62, 56.10], [12.70, 55.95], [12.79, 55.78],
        [12.84, 55.64], [12.78, 55.52], [12.82, 55.40], [12.95, 55.20], [13.20, 54.95]]];
    },
    areas: [['DANMARK', 11.95, 55.80], ['SVERIGE', 13.45, 55.90]]
  };

  function maps(icao) { return function () { return (window.MAPS[icao] || {}).coast || []; }; }
  function water(icao) { return function () { var m = window.MAPS[icao] || {}; return (m.water || []).concat(m.rivers || []); }; }
  function borders(icao) { return function () { return (window.MAPS[icao] || {}).borders || []; }; }

  var AIRPORTS = {
    EKCH: {
      icao: 'EKCH', iata: 'CPH', city: 'KØBENHAVN', title: ['KASTRUP', 'TERMINAL AREA'],
      lat: 55.6180, lon: 12.6508, transition: 5000,
      runways: [[55.6045, 12.6290, 55.6290, 12.6620], [55.5960, 12.6530, 55.6160, 12.6860], [55.6280, 12.6280, 55.6160, 12.6680]],
      coast: ORESUND.coast, places: ORESUND.places, borders: ORESUND.borders, areas: ORESUND.areas
    },
    ESMS: {
      icao: 'ESMS', iata: 'MMX', city: 'MALMÖ', title: ['STURUP', 'TERMINAL AREA'],
      lat: 55.5363, lon: 13.3762, transition: 5000,
      runways: [[55.5489, 13.3725, 55.5237, 13.3803]],
      coast: ORESUND.coast, places: ORESUND.places, borders: ORESUND.borders, areas: ORESUND.areas
    },
    ESSA: {
      icao: 'ESSA', iata: 'ARN', city: 'STOCKHOLM', title: ['ARLANDA', 'TERMINAL AREA'],
      lat: 59.6519, lon: 17.9186, transition: 5000,
      runways: [[59.6266, 17.9446, 59.6558, 17.9548], [59.6403, 17.9000, 59.6624, 17.9077], [59.6555, 17.8946, 59.6594, 17.9384]],
      coast: maps('ESSA'), water: water('ESSA'),
      places: [
        ['STOCKHOLM', 18.068, 59.329, 'r'], ['UPPSALA', 17.639, 59.858, 'r'], ['SIGTUNA', 17.723, 59.617, 'l'],
        ['NORRTÄLJE', 18.701, 59.758, 'r'], ['SÖDERTÄLJE', 17.627, 59.196, 'l'], ['VÄSTERÅS', 16.545, 59.611, 'r'],
        ['ENKÖPING', 17.078, 59.636, 'r'], ['NYNÄSHAMN', 17.948, 58.903, 'r'], ['VAXHOLM', 18.351, 59.402, 'r']
      ],
      areas: [['MÄLAREN', 16.95, 59.42], ['ÖSTERSJÖN', 19.10, 59.10]]
    },
    EGLL: {
      icao: 'EGLL', iata: 'LHR', city: 'LONDON', title: ['HEATHROW', 'TERMINAL AREA'],
      lat: 51.4700, lon: -0.4543, transition: 6000,
      runways: [[51.4775, -0.4851, 51.4777, -0.4330], [51.4647, -0.4823, 51.4650, -0.4340]],
      coast: maps('EGLL'), water: water('EGLL'),
      places: [
        ['LONDON', -0.128, 51.507, 'r'], ['READING', -0.973, 51.454, 'l'], ['SLOUGH', -0.595, 51.511, 'l'],
        ['WATFORD', -0.396, 51.656, 'r'], ['GUILDFORD', -0.570, 51.236, 'l'], ['CROYDON', -0.099, 51.376, 'r'],
        ['LUTON', -0.420, 51.879, 'r'], ['OXFORD', -1.258, 51.752, 'r'], ['CHELMSFORD', 0.469, 51.736, 'r'],
        ['BRIGHTON', -0.137, 50.823, 'r']
      ],
      areas: [['ENGLAND', -1.45, 51.20], ['THAMES', 0.55, 51.42]]
    },
    KJFK: {
      icao: 'KJFK', iata: 'JFK', city: 'NEW YORK', title: ['KENNEDY', 'TERMINAL AREA'],
      lat: 40.6413, lon: -73.7781, transition: 18000,
      scale: 940,   // twice the usual: the 50 km ring fills the map
      runways: [[40.6222, -73.7856, 40.6453, -73.7642], [40.6254, -73.7703, 40.6455, -73.7556],
        [40.6574, -73.7900, 40.6437, -73.7563], [40.6484, -73.8165, 40.6152, -73.7591]],
      coast: maps('KJFK'), water: water('KJFK'),
      places: [
        ['MANHATTAN', -73.971, 40.776, 'l'], ['BROOKLYN', -73.950, 40.650, 'l'], ['STATEN ISLAND', -74.150, 40.580, 'l'],
        ['LAGUARDIA', -73.874, 40.777, 'r'], ['NEWARK EWR', -74.175, 40.690, 'l'],
        ['WHITE PLAINS', -73.763, 41.034, 'r'], ['STAMFORD', -73.539, 41.053, 'r'], ['HEMPSTEAD', -73.619, 40.706, 'r'],
        ['HUNTINGTON', -73.426, 40.868, 'r']
      ],
      areas: [['NEW JERSEY', -74.60, 40.45], ['ATLANTIC', -73.45, 40.42], ['LONG ISLAND', -73.45, 40.78]]
    },
    KIAD: {
      icao: 'KIAD', iata: 'IAD', city: 'WASHINGTON', title: ['DULLES', 'TERMINAL AREA'],
      lat: 38.9531, lon: -77.4565, transition: 18000,
      runways: [[38.9380, -77.4590, 38.9700, -77.4590], [38.9300, -77.4370, 38.9620, -77.4370],
        [38.9470, -77.4740, 38.9760, -77.4740], [38.9610, -77.4950, 38.9480, -77.4680]],
      coast: maps('KIAD'), water: water('KIAD'),
      places: [
        ['WASHINGTON', -77.037, 38.907, 'r'], ['ALEXANDRIA', -77.047, 38.805, 'r'], ['BALTIMORE', -76.612, 39.290, 'r'],
        ['ANNAPOLIS', -76.492, 38.978, 'r'], ['LEESBURG', -77.564, 39.115, 'l'], ['FREDERICK', -77.410, 39.414, 'r'],
        ['MANASSAS', -77.475, 38.751, 'l'], ['FRONT ROYAL', -78.194, 38.918, 'r']
      ],
      areas: [['VIRGINIA', -78.00, 38.55], ['MARYLAND', -77.05, 39.62], ['POTOMAC', -77.30, 38.45]]
    },
    ENGM: {
      icao: 'ENGM', iata: 'OSL', city: 'OSLO', title: ['GARDERMOEN', 'TERMINAL AREA'],
      lat: 60.1939, lon: 11.1004, transition: 7000,
      runways: [[60.1745, 11.0790, 60.2060, 11.0960], [60.1810, 11.1060, 60.2130, 11.1230]],
      coast: maps('ENGM'), water: water('ENGM'), borders: borders('ENGM'),
      places: [
        ['OSLO', 10.752, 59.913, 'r'], ['LILLESTRØM', 11.049, 59.956, 'r'], ['EIDSVOLL', 11.260, 60.330, 'r'],
        ['HAMAR', 11.068, 60.795, 'r'], ['GJØVIK', 10.692, 60.796, 'l'], ['DRAMMEN', 10.205, 59.744, 'l'],
        ['HØNEFOSS', 10.257, 60.168, 'l'], ['KONGSVINGER', 11.998, 60.190, 'r']
      ],
      areas: [['NORGE', 9.90, 60.45], ['SVERIGE', 12.55, 59.85], ['MJØSA', 10.55, 60.62]]
    },
    EDDB: {
      icao: 'EDDB', iata: 'BER', city: 'BERLIN', title: ['BRANDENBURG', 'TERMINAL AREA'],
      lat: 52.3667, lon: 13.5033, transition: 5000,
      runways: [[52.3786, 13.4691, 52.3909, 13.5245], [52.3540, 13.4970, 52.3655, 13.5490]],
      coast: maps('EDDB'), water: water('EDDB'), borders: borders('EDDB'),
      places: [
        ['BERLIN', 13.405, 52.520, 'r'], ['POTSDAM', 13.064, 52.391, 'l'], ['BRANDENBURG', 12.556, 52.411, 'l'],
        ['ORANIENBURG', 13.237, 52.754, 'r'], ['EBERSWALDE', 13.820, 52.833, 'r'], ['FRANKFURT (O)', 14.551, 52.347, 'l'],
        ['LÜBBEN', 13.896, 51.942, 'r'], ['COTTBUS', 14.334, 51.756, 'r']
      ],
      areas: [['DEUTSCHLAND', 12.20, 52.05], ['POLSKA', 14.75, 52.65]]
    },
    LFPG: {
      icao: 'LFPG', iata: 'CDG', city: 'PARIS', title: ['ROISSY', 'TERMINAL AREA'],
      lat: 49.0097, lon: 2.5479, transition: 5000,
      runways: [[49.0247, 2.5133, 49.0262, 2.5650], [49.0208, 2.5172, 49.0218, 2.5610],
        [49.0056, 2.5233, 49.0040, 2.5762], [48.9958, 2.5300, 48.9970, 2.5960]],
      coast: maps('LFPG'), water: water('LFPG'), borders: borders('LFPG'),
      places: [
        ['PARIS', 2.352, 48.857, 'l'], ['VERSAILLES', 2.130, 48.805, 'l'], ['MEAUX', 2.879, 48.960, 'r'],
        ['CERGY', 2.063, 49.036, 'l'], ['CHANTILLY', 2.471, 49.194, 'r'], ['BEAUVAIS', 2.081, 49.430, 'r'],
        ['COMPIÈGNE', 2.826, 49.418, 'r'], ['MELUN', 2.656, 48.540, 'r']
      ],
      areas: [['ÎLE-DE-FRANCE', 1.35, 48.65], ['SEINE', 1.75, 49.10]]
    },
    // Australia: transition altitude 10,000 ft everywhere
    YSSY: {
      icao: 'YSSY', iata: 'SYD', city: 'SYDNEY', title: ['KINGSFORD SMITH', 'TERMINAL AREA'],
      lat: -33.9461, lon: 151.1772, transition: 10000,
      runways: [[-33.9330, 151.1690, -33.9660, 151.1830], [-33.9500, 151.1880, -33.9700, 151.1960], [-33.9440, 151.1630, -33.9470, 151.1900]],
      coast: maps('YSSY'), water: water('YSSY'),
      places: [
        ['SYDNEY', 151.209, -33.868, 'r'], ['PARRAMATTA', 151.003, -33.815, 'l'], ['MANLY', 151.285, -33.797, 'r'],
        ['CRONULLA', 151.153, -34.056, 'r'], ['WOLLONGONG', 150.893, -34.425, 'r'], ['CAMPBELLTOWN', 150.814, -34.066, 'l'],
        ['PENRITH', 150.694, -33.751, 'l'], ['GOSFORD', 151.342, -33.425, 'r'], ['KATOOMBA', 150.311, -33.712, 'r']
      ],
      areas: [['TASMAN SEA', 151.60, -34.30], ['BLUE MOUNTAINS', 149.95, -33.45]]
    },
    YMML: {
      icao: 'YMML', iata: 'MEL', city: 'MELBOURNE', title: ['TULLAMARINE', 'TERMINAL AREA'],
      lat: -37.6690, lon: 144.8410, transition: 10000,
      runways: [[-37.6500, 144.8350, -37.6820, 144.8460], [-37.6600, 144.8300, -37.6610, 144.8560]],
      coast: maps('YMML'), water: water('YMML'),
      places: [
        ['MELBOURNE', 144.963, -37.814, 'r'], ['GEELONG', 144.361, -38.149, 'l'], ['BALLARAT', 143.850, -37.562, 'l'],
        ['BENDIGO', 144.280, -36.757, 'r'], ['FRANKSTON', 145.125, -38.144, 'r'], ['DANDENONG', 145.215, -37.987, 'r']
      ],
      areas: [['PORT PHILLIP', 144.55, -38.05], ['VICTORIA', 143.40, -37.10]]
    },
    YBBN: {
      icao: 'YBBN', iata: 'BNE', city: 'BRISBANE', title: ['BRISBANE', 'TERMINAL AREA'],
      lat: -27.3842, lon: 153.1175, transition: 10000,
      runways: [[-27.4020, 153.0990, -27.3730, 153.1100], [-27.3950, 153.1230, -27.3640, 153.1340]],
      coast: maps('YBBN'), water: water('YBBN'),
      places: [
        ['BRISBANE', 153.026, -27.470, 'l'], ['IPSWICH', 152.760, -27.614, 'l'], ['REDCLIFFE', 153.100, -27.230, 'r'],
        ['CABOOLTURE', 152.951, -27.085, 'l'], ['LOGAN', 153.110, -27.640, 'r'], ['GOLD COAST', 153.400, -28.017, 'r'],
        ['NOOSA', 153.090, -26.390, 'r'], ['TOOWOOMBA', 151.950, -27.560, 'r']
      ],
      areas: [['MORETON BAY', 153.25, -27.35], ['CORAL SEA', 153.60, -26.95]]
    },
    YPAD: {
      icao: 'YPAD', iata: 'ADL', city: 'ADELAIDE', title: ['ADELAIDE', 'TERMINAL AREA'],
      lat: -34.9450, lon: 138.5306, transition: 10000,
      runways: [[-34.9550, 138.5180, -34.9360, 138.5470], [-34.9370, 138.5250, -34.9500, 138.5400]],
      coast: maps('YPAD'), water: water('YPAD'),
      places: [
        ['ADELAIDE', 138.601, -34.929, 'r'], ['GAWLER', 138.745, -34.598, 'r'], ['MOUNT BARKER', 138.857, -35.067, 'r'],
        ['VICTOR HARBOR', 138.617, -35.552, 'r'], ['MURRAY BRIDGE', 139.272, -35.120, 'r']
      ],
      areas: [['GULF ST VINCENT', 137.90, -35.10], ['YORKE PENINSULA', 137.30, -34.55]]
    },
    YPPH: {
      icao: 'YPPH', iata: 'PER', city: 'PERTH', title: ['PERTH', 'TERMINAL AREA'],
      lat: -31.9403, lon: 115.9669, transition: 10000,
      runways: [[-31.9550, 115.9580, -31.9270, 115.9810], [-31.9440, 115.9530, -31.9330, 115.9730]],
      coast: maps('YPPH'), water: water('YPPH'),
      places: [
        ['PERTH', 115.861, -31.952, 'l'], ['FREMANTLE', 115.746, -32.056, 'l'], ['JOONDALUP', 115.766, -31.745, 'l'],
        ['ROCKINGHAM', 115.731, -32.280, 'l'], ['MANDURAH', 115.721, -32.529, 'l'], ['NORTHAM', 116.665, -31.652, 'r']
      ],
      areas: [['INDIAN OCEAN', 114.90, -32.30]]
    }
  };

  window.AIRPORTS = AIRPORTS;
  window.AIRPORT_CHOICES = ['EKCH', 'ESMS', 'ESSA', 'ENGM', 'EDDB', 'LFPG', 'EGLL', 'KJFK', 'KIAD',
    'YSSY', 'YMML', 'YBBN', 'YPAD', 'YPPH'];
})();
