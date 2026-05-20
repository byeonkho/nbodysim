// Hybrid · Dark Glass sophistication + Mission Control density
// Indigo accent, glass panels, refined type — but packed with telemetry,
// integrator residuals, structured event log, and a real timeline scrubber.

const hy = {
  bg:'#0a0b10', text:'#dcdde3', accent:'#a4a8ff', amber:'#f0a942',
  dim:'#7f828d', subdim:'#5a5d68', hi:'#f4f5f8', success:'#7dd3a0',
  mono:{fontFamily:"'JetBrains Mono',monospace", fontVariantNumeric:'tabular-nums'},
};

const hyGlass = {
  background:'rgba(20,22,30,0.62)',
  backdropFilter:'blur(22px) saturate(150%)',
  WebkitBackdropFilter:'blur(22px) saturate(150%)',
  border:'1px solid rgba(255,255,255,0.06)',
  boxShadow:'0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 60px rgba(0,0,0,0.5)',
  borderRadius:14,
};

// ── Top status strip (MC-style telemetry, DG-style glass) ──────────────
function HyTopBar() {
  const cell = (label, value, opts={}) => (
    <div style={{display:'flex', alignItems:'baseline', gap:6, padding:'0 14px',
      borderRight:'1px solid rgba(255,255,255,0.06)', height:'100%',
      ...((opts.flex && {flex:opts.flex}) || {})}}
      key={label}>
      <span style={{...hy.mono, fontSize:9, color:hy.subdim, letterSpacing:'0.18em', textTransform:'uppercase', alignSelf:'center'}}>{label}</span>
      <span style={{...hy.mono, fontSize:11, color:opts.color||hy.hi, alignSelf:'center'}}>{value}</span>
    </div>
  );
  return (
    <div style={{position:'absolute', top:18, left:24, right:24, height:42,
      ...hyGlass, padding:0, display:'flex', alignItems:'stretch', borderRadius:12, overflow:'hidden'}}>
      <div style={{display:'flex', alignItems:'center', gap:10, padding:'0 16px', borderRight:'1px solid rgba(255,255,255,0.06)'}}>
        <div style={{width:22, height:22, borderRadius:6, background:'linear-gradient(135deg, #a4a8ff, #6e74d4)',
          boxShadow:'0 4px 14px rgba(164,168,255,0.4)'}}/>
        <span style={{fontSize:13, fontWeight:600, color:hy.hi, letterSpacing:'-0.01em'}}>spacesim</span>
      </div>
      {cell('UTC','2024-06-17 07:00:00.000')}
      {cell('JD','2 460 478.79167')}
      {cell('Frame','Heliocentric')}
      {cell('Integrator','RK4', {color:hy.accent})}
      {cell('Δt','3600 s')}
      <div style={{flex:1}}/>
      {cell('Bodies','9')}
      {cell('FPS','144', {color:hy.success})}
      <div style={{display:'flex', alignItems:'center', gap:8, padding:'0 16px', background:'rgba(240,169,66,0.08)'}}>
        <span style={{width:6, height:6, borderRadius:'50%', background:hy.amber, boxShadow:`0 0 8px ${hy.amber}`}}/>
        <span style={{...hy.mono, fontSize:10, color:hy.amber, letterSpacing:'0.10em'}}>REC 00:14:22</span>
      </div>
    </div>
  );
}

// ── Body selector row ──────────────────────────────────────────────────
function HyPill({n, c, code, active}) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:8, padding:'7px 13px',
      borderRadius:999,
      background: active ? 'rgba(164,168,255,0.14)' : 'transparent',
      border: active ? '1px solid rgba(164,168,255,0.32)' : '1px solid transparent',
      cursor:'pointer', position:'relative',
    }}>
      <div style={{width:13, height:13, borderRadius:'50%',
        background:`radial-gradient(circle at 30% 30%, ${c} 0%, ${c} 50%, ${shadeColor(c,-60)} 100%)`,
        boxShadow: active ? `0 0 10px ${c}88` : 'none',
      }}/>
      <span style={{fontSize:12, fontWeight: active?600:500, color: active?hy.hi:'#b1b4be'}}>{n}</span>
      {active && <span style={{...hy.mono, fontSize:9, color:hy.subdim, marginLeft:2}}>{code}</span>}
    </div>
  );
}
function HySelector({active}) {
  const planets = [
    ['Sun','#ffb554','10'],['Mercury','#a59387','199'],['Venus','#e6c692','299'],
    ['Earth','#5d8fd6','399'],['Mars','#c5573a','499'],['Jupiter','#d4a566','599'],
    ['Saturn','#dcb474','699'],['Uranus','#7fc7c5','799'],['Neptune','#4a78c0','899'],
  ];
  return (
    <div style={{position:'absolute', top:74, left:'50%', transform:'translateX(-50%)',
      ...hyGlass, padding:6, display:'flex', alignItems:'center', gap:2, borderRadius:999}}>
      {planets.map(([n,c,code]) => <HyPill key={n} n={n} c={c} code={code} active={n===active}/>)}
    </div>
  );
}

// ── Body card with full orbital elements (MC density) ──────────────────
function HyKV({k, v, unit, color, copyable}) {
  return (
    <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:14, alignItems:'baseline',
      padding:'5px 0'}}>
      <span style={{fontSize:11, color:hy.dim}}>{k}</span>
      <span style={{...hy.mono, fontSize:12, color:color||hy.hi, letterSpacing:'-0.01em'}}>
        {v}{unit && <span style={{color:hy.subdim, marginLeft:4, fontSize:10}}>{unit}</span>}
      </span>
    </div>
  );
}
function HySubLabel({children}) {
  return (
    <div style={{fontSize:9, color:hy.subdim, letterSpacing:'0.18em', textTransform:'uppercase',
      fontWeight:600, marginBottom:4, marginTop:12, paddingTop:10,
      borderTop:'1px dashed rgba(255,255,255,0.06)',
    }}>{children}</div>
  );
}

function HyBodyCard() {
  return (
    <div style={{...hyGlass, padding:'16px 18px 14px'}}>
      {/* Header */}
      <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:10}}>
        <div style={{width:18, height:18, borderRadius:'50%',
          background:`radial-gradient(circle at 30% 30%, #5d8fd6 0%, #5d8fd6 50%, ${shadeColor('#5d8fd6',-60)} 100%)`,
          boxShadow:`0 0 14px #5d8fd699`}}/>
        <div style={{fontSize:17, fontWeight:600, color:hy.hi, letterSpacing:'-0.015em'}}>Earth</div>
        <div style={{flex:1}}/>
        <div style={{...hy.mono, fontSize:10, color:hy.subdim, letterSpacing:'0.04em'}}>NAIF · 399</div>
      </div>
      <div style={{fontSize:11, color:hy.dim, lineHeight:1.55, marginBottom:6}}>
        Third body from the Sun. Tracking in heliocentric frame.
      </div>

      {/* State vector */}
      <HySubLabel>State vector · J2000</HySubLabel>
      <HyKV k="Range to Sun" v="1.0142" unit="AU"/>
      <HyKV k="Speed" v="29.291" unit="km/s" color={hy.accent}/>
      <HyKV k="r⃗ · x" v="−1.484×10⁸" unit="km"/>
      <HyKV k="r⃗ · y" v="+0.187×10⁸" unit="km"/>
      <HyKV k="v⃗ · ‖" v="29.291" unit="km/s"/>

      {/* Orbital elements */}
      <HySubLabel>Keplerian elements</HySubLabel>
      <HyKV k="Semi-major axis" v="1.4960×10⁸" unit="km"/>
      <HyKV k="Eccentricity e" v="0.01671"/>
      <HyKV k="Inclination i" v="0.0005°"/>
      <HyKV k="True anomaly ν" v="158.42°"/>
      <HyKV k="Mean motion n" v="0.9856°/d"/>
      <HyKV k="Orbital period" v="365.256" unit="d"/>

      {/* Integrator residuals */}
      <HySubLabel>Integrator residual</HySubLabel>
      <HyKV k="Energy drift ΔE/E₀" v="2.3×10⁻⁹" color={hy.success}/>
      <HyKV k="Step accept" v="100.0%"/>
      <HyKV k="Last step error" v="1.1×10⁻¹²"/>
    </div>
  );
}

// ── Event log (kept rich) ──────────────────────────────────────────────
function HyEventLog() {
  const items = [
    ['07:00:00','accent','Now tracking · Earth'],
    ['06:58:11','amber','Mars perihelion approach · 1.382 AU'],
    ['06:42:03','dim','Earth–Moon barycenter computed'],
    ['06:31:55','accent','Trails enabled · 9 bodies'],
    ['06:14:09','dim','Frame switch · barycentric → heliocentric'],
    ['05:14:28','dim','Sim init · J2000 epoch'],
    ['05:14:28','dim','Bodies loaded (9)'],
    ['05:14:27','dim','Integrator RK4 selected'],
  ];
  return (
    <div style={{...hyGlass, padding:0}}>
      <div style={{padding:'12px 16px 10px', display:'flex', justifyContent:'space-between', alignItems:'center',
        borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <span style={{fontSize:12, fontWeight:600, color:hy.hi, letterSpacing:'-0.01em'}}>Event log</span>
          <span style={{fontSize:10, color:hy.subdim, padding:'1px 6px', borderRadius:4,
            background:'rgba(255,255,255,0.05)', ...hy.mono}}>8</span>
        </div>
        <div style={{display:'flex', gap:4}}>
          {['ALL','SIM','USR'].map((t,i)=>(
            <span key={t} style={{
              padding:'3px 8px', borderRadius:5, ...hy.mono, fontSize:9, letterSpacing:'0.10em',
              color: i===0 ? hy.accent : hy.subdim,
              background: i===0 ? 'rgba(164,168,255,0.10)' : 'transparent',
              border: i===0 ? '1px solid rgba(164,168,255,0.20)' : '1px solid transparent',
              cursor:'pointer',
            }}>{t}</span>
          ))}
        </div>
      </div>
      <div style={{padding:'6px 0', maxHeight:280, overflow:'hidden'}}>
        {items.map(([t,c,m],i) => (
          <div key={i} style={{display:'flex', gap:10, padding:'5px 16px', alignItems:'baseline'}}>
            <span style={{...hy.mono, fontSize:10, color:hy.subdim, minWidth:54}}>{t}</span>
            <span style={{
              width:5, height:5, borderRadius:'50%', alignSelf:'center', flexShrink:0,
              background: c==='accent' ? hy.accent : c==='amber' ? hy.amber : 'rgba(255,255,255,0.18)',
              boxShadow: c==='accent' ? `0 0 6px ${hy.accent}` : c==='amber' ? `0 0 6px ${hy.amber}` : 'none',
            }}/>
            <span style={{fontSize:11.5, color: c==='dim' ? hy.dim : hy.text, flex:1, lineHeight:1.5, letterSpacing:'-0.005em'}}>{m}</span>
          </div>
        ))}
      </div>
      <div style={{padding:'8px 16px', borderTop:'1px solid rgba(255,255,255,0.06)',
        ...hy.mono, fontSize:10, color:hy.subdim, display:'flex', justifyContent:'space-between'}}>
        <span>last 60m</span>
        <span style={{color:hy.dim, cursor:'pointer'}}>view all →</span>
      </div>
    </div>
  );
}

// ── Left rail ──────────────────────────────────────────────────────────
function HyLeftRail({active=2}) {
  const icons = [
    'M11 3v2M11 17v2M3 11h2M17 11h2M5 5l1.4 1.4M15.6 15.6L17 17M5 17l1.4-1.4M15.6 6.4L17 5',
    'M11 3a8 8 0 100 16 8 8 0 000-16zm-3 8a3 3 0 116 0 3 3 0 01-6 0z',
    'M11 3l8 4-8 4-8-4 8-4zM3 11l8 4 8-4M3 15l8 4 8-4',
    'M5 7h3l1-2h4l1 2h3v9H5V7zm6 2a3 3 0 100 6 3 3 0 000-6z',
    'M11 8a3 3 0 110 6 3 3 0 010-6zM11 3v2M11 17v2M3 11h2M17 11h2',
  ];
  return (
    <div style={{position:'absolute', top:'50%', left:24, transform:'translateY(-50%)',
      ...hyGlass, padding:8, borderRadius:14, display:'flex', flexDirection:'column', gap:4}}>
      {icons.map((d,i) => (
        <button key={i} style={{
          width:38, height:38, border:'none', cursor:'pointer',
          background: i===active ? 'rgba(164,168,255,0.18)' : 'transparent',
          borderRadius:10, display:'grid', placeItems:'center',
          color: i===active ? hy.accent : '#b1b4be',
        }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d={d}/>
          </svg>
        </button>
      ))}
      <div style={{height:1, background:'rgba(255,255,255,0.06)', margin:'4px 4px'}}/>
      <button style={{
        width:38, height:38, border:'none', cursor:'pointer', background:'transparent',
        borderRadius:10, display:'grid', placeItems:'center', color:'#b1b4be',
      }}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="3"/><path d="M10 1v3M10 16v3M1 10h3M16 10h3"/>
        </svg>
      </button>
    </div>
  );
}

// ── Bottom: scrubber with timeline ticks (MC density, DG glass) ────────
function HyTimeline() {
  return (
    <div style={{position:'absolute', bottom:18, left:24, right:24,
      ...hyGlass, padding:'14px 18px', display:'flex', alignItems:'center', gap:18, borderRadius:14}}>
      {/* Transport + rate */}
      <div style={{display:'flex', alignItems:'center', gap:6}}>
        {[
          {d:'M5 4l-2 2 2 2M9 4l-2 2 2 2', i:0},
          {d:'M9 4l6 4-6 4V4z', i:1, primary:true},
          {d:'M3 4l2 2-2 2M7 4l2 2-2 2', i:2},
        ].map(({d,i,primary}) => (
          <button key={i} style={{
            width:36, height:36, borderRadius:10, border:'none', cursor:'pointer',
            background: primary ? hy.accent : 'rgba(255,255,255,0.05)',
            color: primary ? hy.bg : hy.text, display:'grid', placeItems:'center',
            boxShadow: primary ? '0 6px 16px rgba(164,168,255,0.35)' : 'none',
          }}>
            <svg width="14" height="14" viewBox="0 0 18 18" fill="currentColor"><path d={d}/></svg>
          </button>
        ))}
      </div>
      <div style={{width:1, height:30, background:'rgba(255,255,255,0.08)'}}/>
      <div>
        <div style={{...hy.mono, fontSize:9, color:hy.subdim, letterSpacing:'0.18em'}}>RATE</div>
        <div style={{display:'flex', alignItems:'baseline', gap:3, marginTop:1}}>
          <span style={{...hy.mono, fontSize:22, fontWeight:500, color:hy.hi, lineHeight:1}}>1.00</span>
          <span style={{fontSize:10, color:hy.dim}}>×</span>
        </div>
      </div>

      {/* Scrubber */}
      <div style={{flex:1, padding:'0 8px'}}>
        <div style={{display:'flex', justifyContent:'space-between', marginBottom:6}}>
          <span style={{...hy.mono, fontSize:9, color:hy.subdim, letterSpacing:'0.18em'}}>TIMELINE · 120 d WINDOW</span>
          <span style={{...hy.mono, fontSize:9, color:hy.subdim, letterSpacing:'0.18em'}}>EPOCH J2000 · T+8 929 d</span>
        </div>
        <div style={{position:'relative', height:32}}>
          <svg width="100%" height="32" style={{position:'absolute', inset:0, overflow:'visible'}}>
            <line x1="0" y1="14" x2="100%" y2="14" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
            {Array.from({length:25}).map((_,i)=>(
              <g key={i}>
                <line x1={`${(i/24)*100}%`} y1={i%6===0?7:11} x2={`${(i/24)*100}%`} y2="14"
                  stroke={i%6===0?'rgba(255,255,255,0.35)':'rgba(255,255,255,0.12)'}/>
                {i%6===0 && (
                  <text x={`${(i/24)*100}%`} y="28" fontSize="9.5" fill={hy.subdim}
                    fontFamily="JetBrains Mono" textAnchor="middle">
                    {['May','Jun','Jul','Aug','Sep'][i/6]}
                  </text>
                )}
              </g>
            ))}
            {/* progress fill */}
            <rect x="0" y="13" width="42%" height="2" fill="url(#hyGrad)" rx="1"/>
            <defs>
              <linearGradient id="hyGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="rgba(164,168,255,0.25)"/>
                <stop offset="1" stopColor={hy.accent}/>
              </linearGradient>
            </defs>
          </svg>
          {/* playhead */}
          <div style={{position:'absolute', left:'42%', top:6, transform:'translateX(-50%)',
            display:'flex', flexDirection:'column', alignItems:'center'}}>
            <div style={{...hy.mono, fontSize:9, color:hy.accent, marginBottom:2, whiteSpace:'nowrap'}}>17 Jun</div>
            <div style={{width:11, height:11, borderRadius:'50%', background:'#fff',
              boxShadow:`0 0 0 3px rgba(164,168,255,0.45), 0 2px 8px rgba(0,0,0,0.4)`}}/>
          </div>
        </div>
      </div>

      <div style={{width:1, height:30, background:'rgba(255,255,255,0.08)'}}/>

      {/* Toggle grid (MC compact pill style, DG color) */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(3, auto)', gap:5}}>
        {[['Grid',false],['Trails',true],['Labels',true],['Axes',false],['Scale','LOG'],['Info','ON']].map(([n,v])=>(
          <button key={n} style={{
            padding:'5px 9px', borderRadius:7,
            background: v ? 'rgba(164,168,255,0.12)' : 'rgba(255,255,255,0.04)',
            border: v ? '1px solid rgba(164,168,255,0.28)' : '1px solid rgba(255,255,255,0.06)',
            color: v ? hy.accent : '#9b9ea9', fontSize:10, fontWeight:500, cursor:'pointer',
            display:'flex', alignItems:'center', gap:6,
          }}>
            <span>{n}</span>
            <span style={{...hy.mono, fontSize:9, opacity:0.7}}>{typeof v==='boolean'?(v?'●':'○'):v}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Reticle on Earth (MC tactical, DG calmed) ─────────────────────────
function HyReticle({x,y}) {
  return (
    <>
      <div style={{position:'absolute', left:x, top:y, pointerEvents:'none'}}>
        {/* outer faint ring */}
        <div style={{position:'absolute', width:88, height:88, left:-44, top:-44, borderRadius:'50%',
          border:`1px solid ${hy.accent}`, opacity:0.15}}/>
        {/* selection ring */}
        <div style={{position:'absolute', width:60, height:60, left:-30, top:-30, borderRadius:'50%',
          border:`1px solid ${hy.accent}`, opacity:0.55}}/>
        {/* tick marks N/E/S/W */}
        <svg width="140" height="140" style={{position:'absolute', left:-70, top:-70}}>
          {[0,90,180,270].map(a => (
            <g key={a} transform={`rotate(${a} 70 70)`}>
              <line x1="70" y1="22" x2="70" y2="30" stroke={hy.accent} strokeWidth="1" opacity="0.7"/>
            </g>
          ))}
        </svg>
      </div>
      {/* Leader line + caption */}
      <svg style={{position:'absolute', inset:0, pointerEvents:'none'}} width="1920" height="1080">
        <path d={`M${x-22} ${y-22} L ${x-110} ${y-70} L ${x-260} ${y-70}`}
          fill="none" stroke={hy.accent} strokeWidth="1" opacity="0.55"/>
        <circle cx={x-22} cy={y-22} r="2.5" fill={hy.accent}/>
      </svg>
      <div style={{position:'absolute', left:x-260, top:y-92, ...hy.mono, fontSize:10,
        color:hy.accent, letterSpacing:'0.10em', whiteSpace:'nowrap'}}>
        <div style={{fontWeight:600}}>● TGT · EARTH (399)</div>
        <div style={{color:hy.dim, marginTop:2, fontSize:9.5}}>Range 1.0142 AU · v 29.291 km/s</div>
      </div>
    </>
  );
}

// ── Ghost labels for non-selected bodies ───────────────────────────────
function HyGhost({x,y,name,sub}) {
  return (
    <div style={{position:'absolute', left:x, top:y, transform:'translate(-50%, -180%)',
      textAlign:'center', pointerEvents:'none'}}>
      <div style={{fontSize:9.5, fontWeight:500, color:'rgba(220,221,227,0.50)',
        letterSpacing:'0.20em', textTransform:'uppercase'}}>{name}</div>
      {sub && <div style={{...hy.mono, fontSize:8.5, color:'rgba(220,221,227,0.32)', marginTop:2}}>{sub}</div>}
    </div>
  );
}

// ── Mini scale + frame compass (extra MC-density touch) ───────────────
function HyScaleBar() {
  return (
    <div style={{position:'absolute', bottom:120, left:24, ...hyGlass, padding:'10px 14px', borderRadius:10}}>
      <div style={{...hy.mono, fontSize:9, color:hy.subdim, letterSpacing:'0.18em', marginBottom:4}}>SCALE</div>
      <div style={{display:'flex', alignItems:'center', gap:8}}>
        <div style={{width:80, height:2, background:'rgba(255,255,255,0.5)', position:'relative'}}>
          <div style={{position:'absolute', left:0, top:-3, width:1, height:8, background:'rgba(255,255,255,0.7)'}}/>
          <div style={{position:'absolute', right:0, top:-3, width:1, height:8, background:'rgba(255,255,255,0.7)'}}/>
        </div>
        <span style={{...hy.mono, fontSize:11, color:hy.hi}}>1 AU</span>
      </div>
      <div style={{...hy.mono, fontSize:9, color:hy.dim, marginTop:6}}>logarithmic · ecliptic plane</div>
    </div>
  );
}

function HyCompass() {
  return (
    <div style={{position:'absolute', top:96, left:24, ...hyGlass, padding:'10px 12px', borderRadius:10,
      width:96, textAlign:'center'}}>
      <div style={{...hy.mono, fontSize:9, color:hy.subdim, letterSpacing:'0.18em', marginBottom:6}}>FRAME</div>
      <svg width="64" height="64" viewBox="0 0 64 64" style={{display:'block', margin:'0 auto'}}>
        <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.10)"/>
        <circle cx="32" cy="32" r="20" fill="none" stroke="rgba(255,255,255,0.06)"/>
        <line x1="32" y1="6" x2="32" y2="58" stroke="rgba(255,255,255,0.10)"/>
        <line x1="6" y1="32" x2="58" y2="32" stroke="rgba(255,255,255,0.10)"/>
        <text x="32" y="13" fontSize="8" fill={hy.dim} fontFamily="JetBrains Mono" textAnchor="middle">+Y</text>
        <text x="58" y="35" fontSize="8" fill={hy.dim} fontFamily="JetBrains Mono" textAnchor="middle">+X</text>
        <circle cx="32" cy="32" r="4" fill={hy.amber}/>
        <text x="32" y="50" fontSize="8" fill={hy.amber} fontFamily="JetBrains Mono" textAnchor="middle">☉</text>
      </svg>
      <div style={{fontSize:10, color:hy.hi, marginTop:4, fontWeight:500}}>Heliocentric</div>
    </div>
  );
}

function Hybrid() {
  return (
    <div style={{position:'absolute', inset:0, background:hy.bg, color:hy.text,
      fontFamily:"'Inter',system-ui,sans-serif", fontSize:13, overflow:'hidden'}} className="ab-root">
      <div className="starfield" style={{opacity:0.55, filter:'hue-rotate(20deg) brightness(0.9)'}}/>
      <Scene orbitColor="rgba(164,168,255,0.07)" trailColor="rgba(164,168,255,0.32)" />

      <HyGhost x={SCENE.bodies.MARS.x} y={SCENE.bodies.MARS.y} name="Mars" sub="1.382 AU"/>
      <HyGhost x={SCENE.bodies.JUPITER.x} y={SCENE.bodies.JUPITER.y} name="Jupiter" sub="5.20 AU"/>
      <HyGhost x={SCENE.bodies.SATURN.x} y={SCENE.bodies.SATURN.y} name="Saturn" sub="9.58 AU"/>
      <HyGhost x={SCENE.bodies.NEPTUNE.x} y={SCENE.bodies.NEPTUNE.y} name="Neptune" sub="30.07 AU"/>
      <HyGhost x={SCENE.bodies.VENUS.x} y={SCENE.bodies.VENUS.y} name="Venus" sub="0.723 AU"/>
      <HyGhost x={SCENE.bodies.MERCURY.x} y={SCENE.bodies.MERCURY.y} name="Mercury" sub="0.387 AU"/>
      <HyGhost x={SCENE.bodies.URANUS.x} y={SCENE.bodies.URANUS.y} name="Uranus" sub="19.18 AU"/>

      <HyReticle x={SCENE.bodies.EARTH.x} y={SCENE.bodies.EARTH.y}/>

      <HyTopBar/>
      <HySelector active="Earth"/>
      <HyCompass/>
      <HyScaleBar/>
      <HyLeftRail active={2}/>

      {/* Right column: rich body card + event log */}
      <div style={{position:'absolute', top:128, right:24, width:316, display:'flex', flexDirection:'column', gap:12,
        bottom:114, overflow:'hidden'}}>
        <HyBodyCard/>
        <HyEventLog/>
      </div>

      <HyTimeline/>
    </div>
  );
}

window.Hybrid = Hybrid;
