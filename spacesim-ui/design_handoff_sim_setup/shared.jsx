// Shared scene primitives — used by every direction's artboard.
// We render the "system view" purely with CSS/SVG so each artboard is editable.

const PLANETS = [
  { key: 'SUN',     name: 'Sun',     color: '#ffb554', size: 28, glow: 60 },
  { key: 'MERCURY', name: 'Mercury', color: '#a59387', size: 6 },
  { key: 'VENUS',   name: 'Venus',   color: '#e6c692', size: 11 },
  { key: 'EARTH',   name: 'Earth',   color: '#5d8fd6', size: 12 },
  { key: 'MARS',    name: 'Mars',    color: '#c5573a', size: 8 },
  { key: 'JUPITER', name: 'Jupiter', color: '#d4a566', size: 22 },
  { key: 'SATURN',  name: 'Saturn',  color: '#dcb474', size: 19, ring: true },
  { key: 'URANUS',  name: 'Uranus',  color: '#7fc7c5', size: 14 },
  { key: 'NEPTUNE', name: 'Neptune', color: '#4a78c0', size: 14 },
];

// Canonical positions in artboard coords (1920×1080) — used by every direction
// so the underlying "scene" is comparable across mockups. Sun centered low-mid.
const SCENE = {
  cx: 960, cy: 620,
  bodies: {
    SUN:     { x: 960, y: 620 },
    MERCURY: { x: 1010, y: 600 },
    VENUS:   { x: 1080, y: 595 },
    EARTH:   { x: 870,  y: 660, label: 'Earth' },
    MOON:    { x: 858,  y: 668 },
    MARS:    { x: 1180, y: 540 },
    JUPITER: { x: 540,  y: 760 },
    SATURN:  { x: 1450, y: 420 },
    URANUS:  { x: 290,  y: 870 },
    NEPTUNE: { x: 1700, y: 280 },
  }
};

// Soft body sphere with subtle terminator shadow.
function Body({ x, y, color, size = 10, glow = 0, ring = false, label }) {
  return (
    <div style={{
      position:'absolute', left:x, top:y,
      width:size*2, height:size*2, marginLeft:-size, marginTop:-size,
      pointerEvents:'none',
    }}>
      {glow > 0 && (
        <div style={{
          position:'absolute', inset:-glow,
          borderRadius:'50%',
          background:`radial-gradient(circle, ${color}55 0%, ${color}00 65%)`,
          filter:'blur(2px)',
        }}/>
      )}
      <div style={{
        position:'absolute', inset:0, borderRadius:'50%',
        background:`radial-gradient(circle at 30% 30%, ${color} 0%, ${color} 45%, ${shadeColor(color,-50)} 100%)`,
        boxShadow:glow > 0
          ? `0 0 ${glow*0.4}px ${color}aa, inset -${size*0.4}px -${size*0.4}px ${size*0.6}px rgba(0,0,0,0.6)`
          : `inset -${size*0.4}px -${size*0.4}px ${size*0.6}px rgba(0,0,0,0.6)`,
      }}/>
      {ring && (
        <div style={{
          position:'absolute', left:'50%', top:'50%',
          width:size*4, height:size*1.2, marginLeft:-size*2, marginTop:-size*0.6,
          border:`1px solid ${color}aa`, borderRadius:'50%',
          transform:'rotate(-12deg)',
          opacity:0.6,
        }}/>
      )}
    </div>
  );
}

function shadeColor(hex, percent) {
  const num = parseInt(hex.replace('#',''), 16);
  let r = (num >> 16) + percent;
  let g = ((num >> 8) & 0xff) + percent;
  let b = (num & 0xff) + percent;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + ((r<<16) | (g<<8) | b).toString(16).padStart(6,'0');
}

// Orbits SVG — concentric ellipses sized to scene.
function Orbits({ stroke = 'rgba(255,255,255,0.06)', strokeWidth = 1, dashed = false }) {
  const radii = [40, 90, 130, 180, 260, 380, 540, 720];
  return (
    <svg width="1920" height="1080" style={{position:'absolute', inset:0, pointerEvents:'none'}}>
      {radii.map((r,i) => (
        <ellipse key={i} cx={SCENE.cx} cy={SCENE.cy} rx={r*1.6} ry={r*0.55}
          fill="none" stroke={stroke} strokeWidth={strokeWidth}
          strokeDasharray={dashed ? '2 6' : 'none'} />
      ))}
    </svg>
  );
}

// Trail behind a body — small SVG arc.
function Trail({ from, to, color = 'rgba(255,255,255,0.4)', width = 1 }) {
  return (
    <svg width="1920" height="1080" style={{position:'absolute', inset:0, pointerEvents:'none'}}>
      <path d={`M${from.x},${from.y} Q${(from.x+to.x)/2-30},${(from.y+to.y)/2-20} ${to.x},${to.y}`}
        fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

// Render the canonical scene for a direction. `style` lets each direction
// recolor orbits, trails, and bodies.
function Scene({ orbitColor, dashedOrbits, showOrbits = true, bodyOverrides = {}, trailColor = 'rgba(255,255,255,0.35)', children }) {
  return (
    <>
      {showOrbits && <Orbits stroke={orbitColor} dashed={dashedOrbits} />}
      {/* trails */}
      <Trail from={{x:780, y:700}} to={SCENE.bodies.EARTH} color={trailColor} />
      <Trail from={{x:1280, y:500}} to={SCENE.bodies.MARS} color={trailColor} />
      <Trail from={{x:600, y:800}} to={SCENE.bodies.JUPITER} color={trailColor} />
      {PLANETS.map(p => {
        const pos = SCENE.bodies[p.key];
        if (!pos) return null;
        const o = bodyOverrides[p.key] || {};
        return <Body key={p.key} x={pos.x} y={pos.y}
          color={o.color || p.color} size={o.size || p.size}
          glow={o.glow !== undefined ? o.glow : (p.glow || 0)}
          ring={p.ring}
        />;
      })}
      {children}
    </>
  );
}

Object.assign(window, { PLANETS, SCENE, Body, Orbits, Trail, Scene, shadeColor });
