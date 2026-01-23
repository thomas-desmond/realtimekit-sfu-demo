// Fixed SVG coordinate system
const SVG_WIDTH = 1000;
const SVG_HEIGHT = 500;
const MAP_BOUNDS = { minLat: -60, maxLat: 85, minLng: -180, maxLng: 180 };

// Performance thresholds - disable animations above these counts
const ANIMATION_THRESHOLD_PARTICIPANTS = 10;
const ANIMATION_THRESHOLD_CONNECTIONS = 15;

// Traditional SFU locations (typical cloud provider regions)
const TRADITIONAL_SFUS = [
  { id: 'TRAD-USE', name: 'US East (Virginia)', lat: 38.95, lng: -77.45 },
  { id: 'TRAD-USW', name: 'US West (Oregon)', lat: 45.84, lng: -119.70 },
  { id: 'TRAD-EUW', name: 'Europe (Frankfurt)', lat: 50.11, lng: 8.68 },
  { id: 'TRAD-EUN', name: 'Europe (London)', lat: 51.51, lng: -0.13 },
  { id: 'TRAD-APS', name: 'Asia Pacific (Singapore)', lat: 1.35, lng: 103.82 },
  { id: 'TRAD-APT', name: 'Asia Pacific (Tokyo)', lat: 35.68, lng: 139.65 },
  { id: 'TRAD-SAM', name: 'South America (São Paulo)', lat: -23.55, lng: -46.63 },
  { id: 'TRAD-AUS', name: 'Australia (Sydney)', lat: -33.87, lng: 151.21 },
];

// =====================================================
// STATE
// =====================================================

let svg, gConnections, gDatacenters, gParticipants;
let participants = [];
let participantIdCounter = 0;
let mode = 'mesh';
let speakerId = null;
let architecture = 'distributed'; // 'distributed' or 'traditional'
let activeTraditionalSFU = null; // The SFU chosen by first participant in traditional mode

// Zoom/Pan state
let viewBox = { x: 0, y: 0, w: SVG_WIDTH, h: SVG_HEIGHT };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panStartViewBox = { x: 0, y: 0, w: SVG_WIDTH, h: SVG_HEIGHT };
let hasDragged = false;
let clickTimeout = null;
let pendingClick = null;
const DRAG_THRESHOLD = 5; // pixels
const DOUBLE_CLICK_DELAY = 250; // ms
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

// =====================================================
// COORDINATE CONVERSION (Fixed coordinate system)
// =====================================================

function latLngToXY(lat, lng) {
  const x = ((lng - MAP_BOUNDS.minLng) / (MAP_BOUNDS.maxLng - MAP_BOUNDS.minLng)) * SVG_WIDTH;
  const y = ((MAP_BOUNDS.maxLat - lat) / (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat)) * SVG_HEIGHT;
  return { x, y };
}

function xyToLatLng(x, y) {
  const lng = MAP_BOUNDS.minLng + (x / SVG_WIDTH) * (MAP_BOUNDS.maxLng - MAP_BOUNDS.minLng);
  const lat = MAP_BOUNDS.maxLat - (y / SVG_HEIGHT) * (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat);
  return { lat, lng };
}

function screenToSVG(screenX, screenY) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = screenX;
  pt.y = screenY;
  const svgP = pt.matrixTransform(ctm.inverse());
  return { x: svgP.x, y: svgP.y };
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestDC(lat, lng) {
  let nearest = DATACENTERS[0];
  let minDist = Infinity;
  for (const dc of DATACENTERS) {
    const dist = haversineDistance(lat, lng, dc.lat, dc.lng);
    if (dist < minDist) { minDist = dist; nearest = dc; }
  }
  return nearest;
}

function findNearestTraditionalSFU(lat, lng) {
  let nearest = TRADITIONAL_SFUS[0];
  let minDist = Infinity;
  for (const sfu of TRADITIONAL_SFUS) {
    const dist = haversineDistance(lat, lng, sfu.lat, sfu.lng);
    if (dist < minDist) { minDist = dist; nearest = sfu; }
  }
  return nearest;
}

function randomLandLocation() {
  const regions = [
    { lat: [25, 50], lng: [-125, -70], weight: 20 },
    { lat: [35, 60], lng: [-10, 40], weight: 25 },
    { lat: [10, 45], lng: [70, 145], weight: 30 },
    { lat: [-35, -20], lng: [115, 155], weight: 10 },
    { lat: [-35, 5], lng: [-75, -35], weight: 10 },
    { lat: [-30, 35], lng: [15, 50], weight: 5 },
  ];
  const total = regions.reduce((s, r) => s + r.weight, 0);
  let rand = Math.random() * total;
  for (const r of regions) {
    rand -= r.weight;
    if (rand <= 0) return {
      lat: r.lat[0] + Math.random() * (r.lat[1] - r.lat[0]),
      lng: r.lng[0] + Math.random() * (r.lng[1] - r.lng[0])
    };
  }
  return { lat: 0, lng: 0 };
}

// =====================================================
// SVG HELPERS
// =====================================================

function createSVGElement(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function createCurvedPath(x1, y1, x2, y2, curve = 0.15) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const cx = mx - dy * curve, cy = my + dx * curve;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

// =====================================================
// MAP INITIALIZATION
// =====================================================

async function initMap() {
  svg = document.getElementById('map-svg');
  
  const gBackground = createSVGElement('g', { class: 'background-layer' });
  gConnections = createSVGElement('g', { class: 'connections-layer' });
  gDatacenters = createSVGElement('g', { class: 'datacenters-layer' });
  gParticipants = createSVGElement('g', { class: 'participants-layer' });
  
  svg.appendChild(gBackground);
  svg.appendChild(gConnections);
  svg.appendChild(gDatacenters);
  svg.appendChild(gParticipants);
  
  await drawWorldMap(gBackground);
  drawGraticule(gBackground);
  drawDatacenters();
  
  svg.addEventListener('click', handleMapClick);
  document.getElementById('loading').classList.add('hidden');
}

async function drawWorldMap(group) {
  try {
    // Use countries GeoJSON for cleaner rendering
    const resp = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
    const topo = await resp.json();
    const countries = topojsonMesh(topo, topo.objects.countries);
    const land = topojsonMerge(topo, topo.objects.countries.geometries);
    
    // Draw land mass as filled shape
    if (land) {
      const pathData = geoPathFromGeometry(land);
      if (pathData) {
        group.appendChild(createSVGElement('path', { d: pathData, class: 'land' }));
      }
    }
  } catch (e) {
    console.warn('Map load failed:', e);
    group.appendChild(createSVGElement('rect', { x: 0, y: 0, width: SVG_WIDTH, height: SVG_HEIGHT, fill: '#1e3a5f', opacity: 0.3 }));
  }
}

// Simplified TopoJSON helpers
function topojsonMerge(topology, geometries) {
  const arcs = topology.arcs;
  const transform = topology.transform;
  
  function decodeArc(arcIdx) {
    const arc = arcs[arcIdx < 0 ? ~arcIdx : arcIdx];
    const coords = [];
    let x = 0, y = 0;
    for (const point of arc) {
      x += point[0];
      y += point[1];
      coords.push([
        x * transform.scale[0] + transform.translate[0],
        y * transform.scale[1] + transform.translate[1]
      ]);
    }
    return arcIdx < 0 ? coords.reverse() : coords;
  }
  
  function decodeRing(ring) {
    const coords = [];
    for (const arcIdx of ring) {
      const arcCoords = decodeArc(arcIdx);
      // Skip first point if not first arc (avoid duplicates)
      const start = coords.length > 0 ? 1 : 0;
      for (let i = start; i < arcCoords.length; i++) {
        coords.push(arcCoords[i]);
      }
    }
    return coords;
  }
  
  const polygons = [];
  for (const geom of geometries) {
    if (geom.type === 'Polygon') {
      polygons.push(geom.arcs.map(decodeRing));
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.arcs) {
        polygons.push(poly.map(decodeRing));
      }
    }
  }
  
  return { type: 'MultiPolygon', coordinates: polygons };
}

function topojsonMesh(topology, obj) {
  return topojsonMerge(topology, obj.geometries || [obj]);
}

function geoPathFromGeometry(geom) {
  const toPath = (ring) => {
    if (!ring || ring.length < 3) return '';
    
    // Split ring at antimeridian crossings to avoid lines spanning the map
    const segments = [];
    let currentSegment = [];
    
    for (let i = 0; i < ring.length; i++) {
      const [lng, lat] = ring[i];
      const prevLng = i > 0 ? ring[i - 1][0] : null;
      
      // Detect antimeridian crossing (jump > 180 degrees)
      if (prevLng !== null && Math.abs(lng - prevLng) > 180) {
        // End current segment and start new one
        if (currentSegment.length > 0) {
          segments.push(currentSegment);
          currentSegment = [];
        }
      }
      
      currentSegment.push([lng, lat]);
    }
    
    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }
    
    // Convert segments to path strings
    return segments.map(seg => {
      if (seg.length < 2) return '';
      return seg.map(([lng, lat], i) => {
        const { x, y } = latLngToXY(lat, lng);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      }).join('');
    }).filter(Boolean).join('');
  };
  
  if (geom.type === 'Polygon') {
    return geom.coordinates.map(toPath).filter(Boolean).join('');
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.map(poly => poly.map(toPath).filter(Boolean).join('')).join('');
  }
  return '';
}

function drawGraticule(group) {
  // Subtle longitude lines every 60 degrees
  for (let lng = -120; lng <= 120; lng += 60) {
    const p1 = latLngToXY(MAP_BOUNDS.maxLat, lng), p2 = latLngToXY(MAP_BOUNDS.minLat, lng);
    group.appendChild(createSVGElement('line', { 
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, 
      class: 'graticule' 
    }));
  }
  // Subtle latitude lines: equator and tropics
  for (const lat of [-30, 0, 30, 60]) {
    const p1 = latLngToXY(lat, MAP_BOUNDS.minLng), p2 = latLngToXY(lat, MAP_BOUNDS.maxLng);
    group.appendChild(createSVGElement('line', { 
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, 
      class: 'graticule' 
    }));
  }
}

function drawDatacenters() {
  // Clear existing markers
  gDatacenters.innerHTML = '';
  
  if (architecture === 'distributed') {
    // Draw all 330 Cloudflare datacenters
    for (const dc of DATACENTERS) {
      const { x, y } = latLngToXY(dc.lat, dc.lng);
      const g = createSVGElement('g', { class: 'dc-marker', 'data-id': dc.id });
      g.appendChild(createSVGElement('circle', { cx: x, cy: y, r: 5, class: 'dc-ring' }));
      g.appendChild(createSVGElement('circle', { cx: x, cy: y, r: 2.5, class: 'dc-dot' }));
      g.addEventListener('mouseenter', (e) => showTooltip(e, dc.name, `Cloudflare PoP - ${dc.id}`));
      g.addEventListener('mouseleave', hideTooltip);
      gDatacenters.appendChild(g);
    }
  } else {
    // Draw only the 8 traditional SFU locations
    for (const sfu of TRADITIONAL_SFUS) {
      const { x, y } = latLngToXY(sfu.lat, sfu.lng);
      const isActive = activeTraditionalSFU && activeTraditionalSFU.id === sfu.id;
      const g = createSVGElement('g', { 
        class: `dc-marker traditional-sfu ${isActive ? 'active-sfu' : 'inactive-sfu'}`, 
        'data-id': sfu.id 
      });
      g.appendChild(createSVGElement('circle', { cx: x, cy: y, r: 6, class: 'dc-ring' }));
      g.appendChild(createSVGElement('circle', { cx: x, cy: y, r: 3, class: 'dc-dot' }));
      
      const status = isActive ? 'Active Meeting Server' : 'Available Region';
      g.addEventListener('mouseenter', (e) => showTooltip(e, sfu.name, status));
      g.addEventListener('mouseleave', hideTooltip);
      gDatacenters.appendChild(g);
    }
  }
}

// =====================================================
// PARTICIPANTS
// =====================================================

function addParticipant(lat, lng, isSpeaker = false) {
  if (participants.length >= 100) return null;
  
  lat = Math.max(MAP_BOUNDS.minLat, Math.min(MAP_BOUNDS.maxLat, lat));
  lng = Math.max(MAP_BOUNDS.minLng, Math.min(MAP_BOUNDS.maxLng, lng));

  let dc;
  if (architecture === 'distributed') {
    // Distributed mode: connect to nearest Cloudflare DC
    dc = findNearestDC(lat, lng);
  } else {
    // Traditional mode: first participant picks the server, everyone else follows
    if (participants.length === 0) {
      // First participant - find nearest traditional SFU
      activeTraditionalSFU = findNearestTraditionalSFU(lat, lng);
      dc = activeTraditionalSFU;
      // Redraw datacenters to show which one is now active
      drawDatacenters();
    } else {
      // Subsequent participants - connect to the active SFU
      dc = activeTraditionalSFU;
    }
  }
  
  const id = ++participantIdCounter;
  const p = { id, lat, lng, dcId: dc.id, dc, isSpeaker: isSpeaker || (mode === 'speaker' && participants.length === 0) };
  
  if (mode === 'speaker' && p.isSpeaker) speakerId = id;
  
  // Check if we're crossing animation threshold
  const wasAnimated = participants.length <= ANIMATION_THRESHOLD_PARTICIPANTS;
  
  participants.push(p);
  drawParticipant(p);
  
  // If we just crossed the threshold, remove animations from existing participants
  const isAnimated = participants.length <= ANIMATION_THRESHOLD_PARTICIPANTS;
  if (wasAnimated && !isAnimated) {
    disableParticipantAnimations();
  }
  
  updateConnections();
  updateStats();
  
  // On mobile, collapse sidebar when user adds participant
  collapseMobileSidebar();
  
  return p;
}

// Collapse sidebar on mobile (when user interacts with map)
function collapseMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || window.innerWidth > 768) return;
  sidebar.classList.remove('expanded');
}

function disableParticipantAnimations() {
  const pulses = gParticipants.querySelectorAll('.participant-pulse.animated');
  pulses.forEach(el => el.classList.remove('animated'));
}

function drawParticipant(p) {
  const { x, y } = latLngToXY(p.lat, p.lng);
  const g = createSVGElement('g', { class: 'participant-marker', 'data-id': p.id });
  
  // Only animate pulse for small number of participants
  const shouldAnimate = participants.length <= ANIMATION_THRESHOLD_PARTICIPANTS;
  const pulseClass = `participant-pulse ${p.isSpeaker ? 'speaker' : ''} ${shouldAnimate ? 'animated' : ''}`;
  
  g.appendChild(createSVGElement('circle', { cx: x, cy: y, r: 3, class: pulseClass }));
  g.appendChild(createSVGElement('circle', { cx: x, cy: y, r: 4, class: `participant-dot ${p.isSpeaker ? 'speaker' : ''}` }));
  
  const dist = Math.round(haversineDistance(p.lat, p.lng, p.dc.lat, p.dc.lng));
  const connectionType = architecture === 'traditional' ? 'Meeting server' : 'Nearest DC';
  g.addEventListener('mouseenter', (e) => showTooltip(e, `Participant ${p.id}`, `${connectionType}: ${p.dc.name} (${dist} km)`));
  g.addEventListener('mouseleave', hideTooltip);
  gParticipants.appendChild(g);
}

function clearParticipants() {
  participants = [];
  speakerId = null;
  participantIdCounter = 0;
  gParticipants.innerHTML = '';
  gConnections.innerHTML = '';
  updateStats();
  document.getElementById('click-hint').classList.remove('hidden');
  
  // Reset traditional SFU state and redraw markers
  if (architecture === 'traditional' && activeTraditionalSFU !== null) {
    activeTraditionalSFU = null;
    drawDatacenters();
  }
}

function updateStats() {
  document.getElementById('participant-count').textContent = participants.length;
}

// =====================================================
// CONNECTIONS
// =====================================================

// Cache for datacenter lookups
const dcCache = new Map();
function getDC(id) {
  if (!dcCache.has(id)) {
    dcCache.set(id, DATACENTERS.find(d => d.id === id));
  }
  return dcCache.get(id);
}

function updateConnections() {
  gConnections.innerHTML = '';
  if (participants.length === 0) return;
  
  const activeDCs = [...new Set(participants.map(p => p.dcId))];
  const connectionCount = mode === 'mesh' 
    ? (activeDCs.length * (activeDCs.length - 1)) / 2 
    : activeDCs.length - 1;
  
  // Only animate if few connections
  const shouldAnimate = connectionCount <= ANIMATION_THRESHOLD_CONNECTIONS;
  const dcLineClass = `connection-line dc-dc-line${shouldAnimate ? ' animated' : ''}`;
  
  // Determine line class based on architecture
  const userLineClass = architecture === 'traditional' 
    ? 'connection-line user-dc-line traditional' 
    : 'connection-line user-dc-line';
  
  // User to DC connections
  for (const p of participants) {
    const pPos = latLngToXY(p.lat, p.lng);
    const dcPos = latLngToXY(p.dc.lat, p.dc.lng);
    gConnections.appendChild(createSVGElement('path', {
      d: createCurvedPath(pPos.x, pPos.y, dcPos.x, dcPos.y, 0.08),
      class: userLineClass
    }));
  }
  
  // DC to DC connections (only in distributed mode)
  if (architecture === 'distributed' && participants.length >= 2) {
    if (mode === 'mesh') {
      for (let i = 0; i < activeDCs.length; i++) {
        for (let j = i + 1; j < activeDCs.length; j++) {
          const dc1 = getDC(activeDCs[i]);
          const dc2 = getDC(activeDCs[j]);
          const p1 = latLngToXY(dc1.lat, dc1.lng), p2 = latLngToXY(dc2.lat, dc2.lng);
          gConnections.appendChild(createSVGElement('path', {
            d: createCurvedPath(p1.x, p1.y, p2.x, p2.y, 0.1),
            class: dcLineClass
          }));
        }
      }
    } else {
      const speaker = participants.find(p => p.id === speakerId);
      if (speaker) {
        const sPos = latLngToXY(speaker.dc.lat, speaker.dc.lng);
        for (const dcId of activeDCs) {
          if (dcId !== speaker.dc.id) {
            const dc = getDC(dcId);
            const dPos = latLngToXY(dc.lat, dc.lng);
            gConnections.appendChild(createSVGElement('path', {
              d: createCurvedPath(sPos.x, sPos.y, dPos.x, dPos.y, 0.1),
              class: dcLineClass
            }));
          }
        }
      }
    }
  }
}

// =====================================================
// MODE
// =====================================================

function setMode(newMode) {
  mode = newMode;
  document.getElementById('btn-mesh').classList.toggle('active', mode === 'mesh');
  document.getElementById('btn-speaker').classList.toggle('active', mode === 'speaker');
  document.getElementById('legend-speaker').style.display = mode === 'speaker' ? 'flex' : 'none';
  
  if (mode === 'mesh') {
    speakerId = null;
    participants.forEach(p => p.isSpeaker = false);
  } else if (participants.length > 0) {
    speakerId = participants[0].id;
    participants.forEach(p => p.isSpeaker = p.id === speakerId);
  }
  
  gParticipants.innerHTML = '';
  participants.forEach(drawParticipant);
  updateConnections();
}

// =====================================================
// ARCHITECTURE MODE
// =====================================================

function setArchitecture(newArch) {
  architecture = newArch;
  const isTraditional = architecture === 'traditional';
  
  // Update toggle buttons
  document.getElementById('btn-distributed').classList.toggle('active', !isTraditional);
  document.getElementById('btn-traditional').classList.toggle('active', isTraditional);
  
  // Update info panels
  document.getElementById('info-distributed').style.display = isTraditional ? 'none' : 'block';
  document.getElementById('info-traditional').style.display = isTraditional ? 'block' : 'none';
  
  // Update legend
  document.getElementById('legend-datacenter').style.display = isTraditional ? 'none' : 'flex';
  document.getElementById('legend-central-server').style.display = isTraditional ? 'flex' : 'none';
  document.getElementById('legend-available-region').style.display = isTraditional ? 'flex' : 'none';
  document.getElementById('legend-user-dc').style.display = isTraditional ? 'none' : 'flex';
  document.getElementById('legend-user-dc-traditional').style.display = isTraditional ? 'flex' : 'none';
  document.getElementById('legend-backbone').style.display = isTraditional ? 'none' : 'flex';
  
  // Update architecture note
  const archNote = document.getElementById('arch-note');
  if (isTraditional) {
    archNote.textContent = 'Not Cloudflare — simulates competitor architecture';
    archNote.style.display = 'block';
  } else {
    archNote.textContent = '';
    archNote.style.display = 'none';
  }
  
  // Add/remove body class for visual differentiation
  document.body.classList.toggle('traditional-mode', isTraditional);
  
  // Clear all participants and reset state when switching modes
  clearParticipants();
  activeTraditionalSFU = null;
  
  // Redraw datacenter markers for the new architecture
  drawDatacenters();
  
  // Show click hint again
  document.getElementById('click-hint').classList.remove('hidden');
}

// =====================================================
// TOOLTIP
// =====================================================

function showTooltip(e, title, subtitle) {
  const tt = document.getElementById('tooltip');
  tt.querySelector('.tooltip-title').textContent = title;
  tt.querySelector('.tooltip-subtitle').textContent = subtitle || '';
  tt.style.left = (e.clientX + 12) + 'px';
  tt.style.top = (e.clientY - 10) + 'px';
  tt.classList.add('visible');
}

function hideTooltip() {
  document.getElementById('tooltip').classList.remove('visible');
}

// =====================================================
// EVENT HANDLERS
// =====================================================

function handleMapClick(e) {
  // Don't process if we dragged
  if (hasDragged) return;
  if (e.target.closest('.dc-marker') || e.target.closest('.participant-marker')) return;
  if (participants.length >= 100) return;
  
  const clickX = e.clientX;
  const clickY = e.clientY;
  
  // If there's a pending click, this is a double-click
  if (pendingClick) {
    clearTimeout(clickTimeout);
    pendingClick = null;
    // Double-click zooms in
    zoomAt(clickX, clickY, 2);
    return;
  }
  
  // Set up pending click - wait to see if it's a double-click
  pendingClick = { x: clickX, y: clickY };
  clickTimeout = setTimeout(() => {
    if (pendingClick && !hasDragged) {
      const { x, y } = screenToSVG(pendingClick.x, pendingClick.y);
      const { lat, lng } = xyToLatLng(x, y);
      addParticipant(lat, lng);
      document.getElementById('click-hint').classList.add('hidden');
    }
    pendingClick = null;
  }, DOUBLE_CLICK_DELAY);
}

// =====================================================
// ZOOM & PAN
// =====================================================

function getZoomLevel() {
  return SVG_WIDTH / viewBox.w;
}

function updateZoomDisplay() {
  const zoom = getZoomLevel();
  document.getElementById('zoom-level').textContent = zoom.toFixed(1) + 'x';
}

function setViewBox(x, y, w, h, animate = false) {
  // Clamp dimensions
  w = Math.max(SVG_WIDTH / MAX_ZOOM, Math.min(SVG_WIDTH, w));
  h = w * (SVG_HEIGHT / SVG_WIDTH);
  
  // Clamp position to keep map in view
  x = Math.max(0, Math.min(SVG_WIDTH - w, x));
  y = Math.max(0, Math.min(SVG_HEIGHT - h, y));
  
  viewBox = { x, y, w, h };
  
  if (animate) {
    svg.style.transition = 'viewBox 0.3s ease';
    setTimeout(() => svg.style.transition = '', 300);
  }
  
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  updateZoomDisplay();
}

function zoomAt(clientX, clientY, factor) {
  const svgRect = svg.getBoundingClientRect();
  
  // Get the point in SVG coordinates where we want to zoom
  const svgPoint = screenToSVG(clientX, clientY);
  
  // Calculate new dimensions
  const newW = viewBox.w / factor;
  const newH = viewBox.h / factor;
  
  // Calculate the ratio of the point within the current viewBox
  const ratioX = (svgPoint.x - viewBox.x) / viewBox.w;
  const ratioY = (svgPoint.y - viewBox.y) / viewBox.h;
  
  // Calculate new position to keep the zoom point stationary
  const newX = svgPoint.x - ratioX * newW;
  const newY = svgPoint.y - ratioY * newH;
  
  setViewBox(newX, newY, newW, newH);
}

function zoomIn() {
  const centerX = viewBox.x + viewBox.w / 2;
  const centerY = viewBox.y + viewBox.h / 2;
  const newW = viewBox.w / 1.5;
  const newH = viewBox.h / 1.5;
  setViewBox(centerX - newW / 2, centerY - newH / 2, newW, newH, true);
}

function zoomOut() {
  const centerX = viewBox.x + viewBox.w / 2;
  const centerY = viewBox.y + viewBox.h / 2;
  const newW = viewBox.w * 1.5;
  const newH = viewBox.h * 1.5;
  setViewBox(centerX - newW / 2, centerY - newH / 2, newW, newH, true);
}

function resetZoom() {
  setViewBox(0, 0, SVG_WIDTH, SVG_HEIGHT, true);
}

function zoomToPoint(lat, lng, zoomLevel = 3) {
  const { x, y } = latLngToXY(lat, lng);
  const w = SVG_WIDTH / zoomLevel;
  const h = SVG_HEIGHT / zoomLevel;
  setViewBox(x - w / 2, y - h / 2, w, h, true);
}

function handleWheel(e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.2 : 0.8;
  zoomAt(e.clientX, e.clientY, factor);
}

function handleMouseDown(e) {
  if (e.button !== 0) return; // Only left mouse button
  if (e.target.closest('.dc-marker') || e.target.closest('.participant-marker')) return;
  
  isPanning = true;
  hasDragged = false;
  panStart = { x: e.clientX, y: e.clientY };
  panStartViewBox = { ...viewBox };
}

function handleMouseMove(e) {
  if (!isPanning) return;
  
  const dx = e.clientX - panStart.x;
  const dy = e.clientY - panStart.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  // Only start dragging if we've moved past threshold
  if (dist > DRAG_THRESHOLD) {
    hasDragged = true;
    svg.style.cursor = 'grabbing';
    
    // Cancel any pending click
    if (pendingClick) {
      clearTimeout(clickTimeout);
      pendingClick = null;
    }
  }
  
  if (hasDragged) {
    // Convert screen pixels to SVG units
    const svgRect = svg.getBoundingClientRect();
    const scaleX = viewBox.w / svgRect.width;
    const scaleY = viewBox.h / svgRect.height;
    
    setViewBox(
      panStartViewBox.x - dx * scaleX,
      panStartViewBox.y - dy * scaleY,
      viewBox.w,
      viewBox.h
    );
  }
}

function handleMouseUp(e) {
  isPanning = false;
  svg.style.cursor = 'grab';
  
  // Reset hasDragged after a short delay so click handler can check it
  setTimeout(() => { hasDragged = false; }, 10);
}

function handleTouchStart(e) {
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    isPanning = true;
    hasDragged = false;
    panStart = { x: touch.clientX, y: touch.clientY };
    panStartViewBox = { ...viewBox };
  }
}

function handleTouchMove(e) {
  if (!isPanning || e.touches.length !== 1) return;
  
  const touch = e.touches[0];
  const dx = touch.clientX - panStart.x;
  const dy = touch.clientY - panStart.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  if (dist > DRAG_THRESHOLD) {
    hasDragged = true;
    e.preventDefault();
    
    const svgRect = svg.getBoundingClientRect();
    const scaleX = viewBox.w / svgRect.width;
    const scaleY = viewBox.h / svgRect.height;
    
    setViewBox(
      panStartViewBox.x - dx * scaleX,
      panStartViewBox.y - dy * scaleY,
      viewBox.w,
      viewBox.h
    );
  }
}

function handleTouchEnd() {
  isPanning = false;
  setTimeout(() => { hasDragged = false; }, 10);
}

// =====================================================
// INIT
// =====================================================

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  
  // Architecture buttons
  document.getElementById('btn-distributed').addEventListener('click', () => setArchitecture('distributed'));
  document.getElementById('btn-traditional').addEventListener('click', () => setArchitecture('traditional'));
  
  // Mode buttons
  document.getElementById('btn-mesh').addEventListener('click', () => setMode('mesh'));
  document.getElementById('btn-speaker').addEventListener('click', () => setMode('speaker'));
  
  // Control buttons
  document.getElementById('btn-random').addEventListener('click', () => {
    const loc = randomLandLocation();
    addParticipant(loc.lat, loc.lng);
    document.getElementById('click-hint').classList.add('hidden');
  });
  document.getElementById('btn-clear').addEventListener('click', clearParticipants);
  
  // Zoom buttons
  document.getElementById('zoom-in').addEventListener('click', zoomIn);
  document.getElementById('zoom-out').addEventListener('click', zoomOut);
  document.getElementById('zoom-reset').addEventListener('click', resetZoom);
  
  // Mouse zoom/pan
  svg.addEventListener('wheel', handleWheel, { passive: false });
  svg.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
  
  // Touch zoom/pan
  svg.addEventListener('touchstart', handleTouchStart, { passive: true });
  svg.addEventListener('touchmove', handleTouchMove, { passive: false });
  svg.addEventListener('touchend', handleTouchEnd);
  
  // Prevent default double-click text selection
  svg.addEventListener('dblclick', (e) => e.preventDefault());
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
    if (e.key === '0') { e.preventDefault(); resetZoom(); }
  });
  
  // Mobile sidebar toggle
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('expanded');
    });
    
    // Swipe to expand/collapse on mobile
    let touchStartY = 0;
    sidebar.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    
    sidebar.addEventListener('touchend', (e) => {
      const touchEndY = e.changedTouches[0].clientY;
      const deltaY = touchStartY - touchEndY;
      
      // Swipe up to expand, swipe down to collapse
      if (deltaY > 50 && !sidebar.classList.contains('expanded')) {
        sidebar.classList.add('expanded');
      } else if (deltaY < -50 && sidebar.classList.contains('expanded')) {
        sidebar.classList.remove('expanded');
      }
    }, { passive: true });
  }
});
