// Hybrid v2 · Sim params promoted out of the rail
// Two changes vs Hybrid:
//   1) Top-bar status cells (Frame · Integrator · Δt) collapsed into ONE clickable
//      "Configuration" chip that summarizes current setup and opens the drawer.
//   2) A labeled, primary-styled "Sim setup" button anchored next to the logo —
//      the obvious first-action for a new user.
// The left rail loses its gear icon entirely and becomes purely navigation.

const h2 = {
  bg:'#0a0b10', text:'#dcdde3', accent:'#a4a8ff', amber:'#f0a942',
  dim:'#7f828d', subdim:'#5a5d68', hi:'#f4f5f8', success:'#7dd3a0',
  mono:{fontFamily:"'JetBrains Mono',monospace", fontVariantNumeric:'tabular-nums'},
};

const h2Glass = {
  background:'rgba(20,22,30,0.62)',
  backdropFilter:'blur(22px) saturate(150%)',
  WebkitBackdropFilter:'blur(22px) saturate(150%)',
  border:'1px solid rgba(255,255,255,0.06)',
  boxShadow:'0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 60px rgba(0,0,0,0.5)',
  borderRadius:14,
};

// ── Top status strip · with Sim setup CTA + Configuration chip ─────────
function H2TopBar({onConfig, configOpen}) {
  return (
    <div style={{position:'absolute', top:18, left:24, right:24, height:46,
      ...h2Glass, padding:0, display:'flex', alignItems:'stretch', borderRadius:12, overflow:'hidden'}}>

      {/* CHANGE #2 — Sim setup primary button, now the leading anchor */}
      <div style={{display:'flex', alignItems:'center', padding:'0 12px 0 14px',
        borderRight:'1px solid rgba(255,255,255,0.06)',
        background: configOpen ? 'transparent' : 'radial-gradient(circle at 50% 120%, rgba(164,168,255,0.18), transparent 70%)'}}>
        <button onClick={onConfig} style={{
          position:'relative',
          display:'flex', alignItems:'center', gap:9,
          padding:'8px 16px 8px 14px', borderRadius:10, cursor:'pointer',
          background: configOpen
            ? 'linear-gradient(180deg, rgba(164,168,255,0.28), rgba(164,168,255,0.18))'
            : 'linear-gradient(180deg, #c4c8ff 0%, #9298ee 100%)',
          border: configOpen
            ? '1px solid rgba(164,168,255,0.55)'
            : '1px solid rgba(196,200,255,0.85)',
          color: configOpen ? h2.hi : '#16182a',
          fontSize:13, fontWeight:600, letterSpacing:'-0.005em',
          boxShadow: configOpen
            ? 'none'
            : '0 0 0 3px rgba(164,168,255,0.18), 0 6px 20px rgba(146,152,238,0.50), 0 1px 0 rgba(255,255,255,0.55) inset',
        }}>
          {/* live status dot — signals "active entrypoint" */}
          {!configOpen && (
            <span style={{position:'absolute', top:-3, right:-3, width:9, height:9, borderRadius:'50%',
              background:'#fff', boxShadow:'0 0 0 2px rgba(164,168,255,0.55), 0 0 8px rgba(255,255,255,0.8)'}}/>
          )}
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2M3 3l1.5 1.5M9.5 9.5L11 11M3 11l1.5-1.5M9.5 4.5L11 3"/>
            <circle cx="7" cy="7" r="2.2"/>
          </svg>
          <span>Sim setup</span>
          <span style={{...h2.mono, fontSize:9.5,
            color: configOpen ? h2.accent : 'rgba(22,24,42,0.65)',
            letterSpacing:'0.08em',
            padding:'1px 5px', borderRadius:3,
            background: configOpen ? 'rgba(164,168,255,0.12)' : 'rgba(22,24,42,0.10)',
            border: configOpen ? '1px solid rgba(164,168,255,0.20)' : '1px solid rgba(22,24,42,0.15)'}}>⌘K</span>
        </button>
      </div>

      {/* CHANGE #1 — Configuration summary chip (clickable, opens same drawer) */}
      <button onClick={onConfig} style={{
        display:'flex', alignItems:'center', gap:0,
        padding:'0 14px', cursor:'pointer',
        background: configOpen ? 'rgba(164,168,255,0.06)' : 'transparent',
        border:'none', borderRight:'1px solid rgba(255,255,255,0.06)',
        color:'inherit', position:'relative',
      }}>
        <span style={{...h2.mono, fontSize:9, color:h2.subdim, letterSpacing:'0.18em',
          textTransform:'uppercase', marginRight:12}}>Config</span>
        <ConfigPart k="Frame" v="Heliocentric"/>
        <ConfigSep/>
        <ConfigPart k="Integrator" v="RK4" highlight/>
        <ConfigSep/>
        <ConfigPart k="Δt" v="3600 s"/>
        <ConfigSep/>
        <ConfigPart k="Bodies" v="9"/>
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke={h2.dim}
          strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
          style={{marginLeft:12, opacity:0.7}}>
          <path d="M2.5 4l3 3 3-3"/>
        </svg>
        {/* hover hint underline */}
        <div style={{position:'absolute', left:14, right:14, bottom:6, height:1,
          background:'rgba(164,168,255,0.18)', borderRadius:1}}/>
      </button>

      {/* Time readouts — kept */}
      <div style={{display:'flex', alignItems:'center', gap:6, padding:'0 14px',
        borderRight:'1px solid rgba(255,255,255,0.06)'}}>
        <span style={{...h2.mono, fontSize:9, color:h2.subdim, letterSpacing:'0.18em',
          textTransform:'uppercase'}}>UTC</span>
        <span style={{...h2.mono, fontSize:11, color:h2.hi}}>2024-06-17 07:00:00.000</span>
      </div>
      <div style={{display:'flex', alignItems:'center', gap:6, padding:'0 14px',
        borderRight:'1px solid rgba(255,255,255,0.06)'}}>
        <span style={{...h2.mono, fontSize:9, color:h2.subdim, letterSpacing:'0.18em',
          textTransform:'uppercase'}}>JD</span>
        <span style={{...h2.mono, fontSize:11, color:h2.hi}}>2 460 478.79167</span>
      </div>

      <div style={{flex:1}}/>

      {/* Right side · FPS + REC */}
      <div style={{display:'flex', alignItems:'center', gap:6, padding:'0 14px',
        borderLeft:'1px solid rgba(255,255,255,0.06)'}}>
        <span style={{...h2.mono, fontSize:9, color:h2.subdim, letterSpacing:'0.18em',
          textTransform:'uppercase'}}>FPS</span>
        <span style={{...h2.mono, fontSize:11, color:h2.success}}>144</span>
      </div>
      <div style={{display:'flex', alignItems:'center', gap:8, padding:'0 16px',
        background:'rgba(240,169,66,0.08)'}}>
        <span style={{width:6, height:6, borderRadius:'50%', background:h2.amber,
          boxShadow:`0 0 8px ${h2.amber}`}}/>
        <span style={{...h2.mono, fontSize:10, color:h2.amber, letterSpacing:'0.10em'}}>REC 00:14:22</span>
      </div>
    </div>
  );
}
function ConfigPart({k, v, highlight}) {
  return (
    <span style={{display:'inline-flex', alignItems:'baseline', gap:6}}>
      <span style={{...h2.mono, fontSize:9, color:h2.subdim, letterSpacing:'0.14em',
        textTransform:'uppercase'}}>{k}</span>
      <span style={{...h2.mono, fontSize:11.5, color: highlight ? h2.accent : h2.hi,
        fontWeight: highlight ? 500 : 400}}>{v}</span>
    </span>
  );
}
function ConfigSep() {
  return <span style={{width:1, height:14, background:'rgba(255,255,255,0.08)', margin:'0 12px',
    alignSelf:'center'}}/>;
}

// ── Body selector row · unchanged in spirit but redrawn locally ────────
function H2Pill({n, c, code, active}) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:8, padding:'7px 13px', borderRadius:999,
      background: active ? 'rgba(164,168,255,0.14)' : 'transparent',
      border: active ? '1px solid rgba(164,168,255,0.32)' : '1px solid transparent',
      cursor:'pointer',
    }}>
      <div style={{width:13, height:13, borderRadius:'50%',
        background:`radial-gradient(circle at 30% 30%, ${c} 0%, ${c} 50%, ${shadeColor(c,-60)} 100%)`,
        boxShadow: active ? `0 0 10px ${c}88` : 'none',
      }}/>
      <span style={{fontSize:12, fontWeight: active?600:500, color: active?h2.hi:'#b1b4be'}}>{n}</span>
      {active && <span style={{...h2.mono, fontSize:9, color:h2.subdim, marginLeft:2}}>{code}</span>}
    </div>
  );
}
function H2Selector({active}) {
  const planets = [
    ['Sun','#ffb554','10'],['Mercury','#a59387','199'],['Venus','#e6c692','299'],
    ['Earth','#5d8fd6','399'],['Mars','#c5573a','499'],['Jupiter','#d4a566','599'],
    ['Saturn','#dcb474','699'],['Uranus','#7fc7c5','799'],['Neptune','#4a78c0','899'],
  ];
  return (
    <div style={{position:'absolute', top:80, left:'50%', transform:'translateX(-50%)',
      ...h2Glass, padding:6, display:'flex', alignItems:'center', gap:2, borderRadius:999}}>
      {planets.map(([n,c,code]) => <H2Pill key={n} n={n} c={c} code={code} active={n===active}/>)}
    </div>
  );
}

// ── Left rail · purely navigation now (no gear) ───────────────────────
function H2LeftRail({active=2}) {
  const icons = [
    'M11 3v2M11 17v2M3 11h2M17 11h2M5 5l1.4 1.4M15.6 15.6L17 17M5 17l1.4-1.4M15.6 6.4L17 5', // sun/view
    'M11 3a8 8 0 100 16 8 8 0 000-16zm-3 8a3 3 0 116 0 3 3 0 01-6 0z', // orbit
    'M11 3l8 4-8 4-8-4 8-4zM3 11l8 4 8-4M3 15l8 4 8-4', // layers
    'M5 7h3l1-2h4l1 2h3v9H5V7zm6 2a3 3 0 100 6 3 3 0 000-6z', // camera/snapshot
  ];
  return (
    <div style={{position:'absolute', top:'50%', left:24, transform:'translateY(-50%)',
      ...h2Glass, padding:8, borderRadius:14, display:'flex', flexDirection:'column', gap:4}}>
      {icons.map((d,i) => (
        <button key={i} style={{
          width:38, height:38, border:'none', cursor:'pointer',
          background: i===active ? 'rgba(164,168,255,0.18)' : 'transparent',
          borderRadius:10, display:'grid', placeItems:'center',
          color: i===active ? h2.accent : '#b1b4be',
        }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d={d}/>
          </svg>
        </button>
      ))}
    </div>
  );
}

// ── Reuse body card + event log + timeline + reticle from Hybrid ──────
// (Hy* components are global on window — re-use them.)

// ── Sim params drawer (slides in from left) ───────────────────────────
function H2Drawer() {
  return (
    <div style={{position:'absolute', top:80, left:24, bottom:114, width:440,
      ...h2Glass, padding:0, borderRadius:14, overflow:'hidden',
      display:'flex', flexDirection:'column',
      boxShadow:'0 1px 0 rgba(255,255,255,0.05) inset, 0 30px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(164,168,255,0.10)'}}>
      {/* Header */}
      <div style={{padding:'16px 20px', borderBottom:'1px solid rgba(255,255,255,0.06)',
        display:'flex', justifyContent:'space-between', alignItems:'flex-start',
        background:'linear-gradient(180deg, rgba(164,168,255,0.06), transparent)'}}>
        <div>
          <div style={{...h2.mono, fontSize:9.5, color:h2.accent, letterSpacing:'0.22em',
            textTransform:'uppercase', fontWeight:500}}>Simulation parameters</div>
          <div style={{fontSize:18, fontWeight:600, color:h2.hi, marginTop:4,
            letterSpacing:'-0.015em'}}>Configure simulation</div>
          <div style={{fontSize:11.5, color:h2.dim, marginTop:4, lineHeight:1.5}}>
            Changes apply on Run. Epoch, frame and integrator define how the system evolves.
          </div>
        </div>
        <button style={{width:28, height:28, borderRadius:7, border:'1px solid rgba(255,255,255,0.08)',
          background:'rgba(255,255,255,0.03)', color:h2.dim, cursor:'pointer',
          display:'grid', placeItems:'center'}}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>
        </button>
      </div>

      {/* Body */}
      <div style={{flex:1, overflow:'hidden', padding:'14px 20px', display:'flex',
        flexDirection:'column', gap:14}}>
        <H2Field label="Epoch" v="2024-05-06 00:00:00 UTC" sub="UTC · J2000-relative"/>
        <H2Select label="Reference frame" v="Heliocentric"
          options={['Heliocentric','Solar-system barycenter','Geocentric']}/>
        <H2Select label="Integrator" v="RK4" highlight
          options={['Euler','RK4','DOPRI8 (DP853)']}
          help="Euler · simple, visibly drifts. RK4 · balanced default. DP853 · adaptive, high accuracy."/>
        <H2Row>
          <H2Select label="Time unit" v="Hours" options={['Seconds','Hours','Days']}/>
          <H2Field label="Δt step" v="3600 s"/>
        </H2Row>

        <div>
          <div style={{...h2.mono, fontSize:9.5, color:h2.subdim, letterSpacing:'0.20em',
            textTransform:'uppercase', marginBottom:8, display:'flex', justifyContent:'space-between'}}>
            <span>Celestial bodies</span>
            <span style={{color:h2.accent}}>9 of 10 enabled</span>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:6}}>
            {[
              ['Sun','#ffb554',true],['Mercury','#a59387',true],['Venus','#e6c692',true],
              ['Earth','#5d8fd6',true],['Mars','#c5573a',true],['Jupiter','#d4a566',true],
              ['Saturn','#dcb474',true],['Uranus','#7fc7c5',true],['Neptune','#4a78c0',true],
              ['Moon','#cccccc',false],
            ].map(([n,c,on]) => (
              <label key={n} style={{
                display:'flex', alignItems:'center', gap:9, padding:'7px 10px', borderRadius:8,
                background: on ? 'rgba(164,168,255,0.06)' : 'rgba(255,255,255,0.02)',
                border: on ? '1px solid rgba(164,168,255,0.18)' : '1px solid rgba(255,255,255,0.05)',
                cursor:'pointer',
              }}>
                <span style={{width:14, height:14, borderRadius:4, display:'grid', placeItems:'center',
                  background: on ? h2.accent : 'transparent',
                  border: on ? 'none' : '1px solid rgba(255,255,255,0.20)',
                  color:'#0a0b10', fontSize:10, fontWeight:700}}>{on?'✓':''}</span>
                <span style={{width:9, height:9, borderRadius:'50%',
                  background:`radial-gradient(circle at 30% 30%, ${c} 0%, ${shadeColor(c,-50)} 100%)`}}/>
                <span style={{fontSize:12, color: on?h2.hi:h2.dim, flex:1}}>{n}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Footer · primary action */}
      <div style={{padding:'14px 20px', borderTop:'1px solid rgba(255,255,255,0.06)',
        background:'rgba(255,255,255,0.02)', display:'flex', gap:10, alignItems:'center'}}>
        <button style={{flex:1, padding:'11px 14px', borderRadius:9, border:'none', cursor:'pointer',
          background:'linear-gradient(180deg, #b4b8ff, #8a90e8)', color:'#0a0b10',
          fontSize:13, fontWeight:600, letterSpacing:'-0.005em',
          boxShadow:'0 6px 20px rgba(164,168,255,0.30), 0 1px 0 rgba(255,255,255,0.4) inset',
          display:'flex', alignItems:'center', justifyContent:'center', gap:8}}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor"><path d="M3 2l8 4.5L3 11V2z"/></svg>
          Run simulation
        </button>
        <button style={{padding:'11px 14px', borderRadius:9, border:'1px solid rgba(255,255,255,0.08)',
          background:'rgba(255,255,255,0.03)', color:h2.text, fontSize:12, cursor:'pointer'}}>
          Save preset
        </button>
      </div>
    </div>
  );
}

function H2Row({children}) {
  return <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>{children}</div>;
}
function H2Field({label, v, sub}) {
  return (
    <div>
      <div style={{...h2.mono, fontSize:9.5, color:h2.subdim, letterSpacing:'0.20em',
        textTransform:'uppercase', marginBottom:6}}>{label}</div>
      <div style={{padding:'9px 12px', borderRadius:8, border:'1px solid rgba(255,255,255,0.06)',
        background:'rgba(255,255,255,0.03)', ...h2.mono, fontSize:12.5, color:h2.hi}}>{v}</div>
      {sub && <div style={{fontSize:10.5, color:h2.subdim, marginTop:4, ...h2.mono,
        letterSpacing:'0.04em'}}>{sub}</div>}
    </div>
  );
}
function H2Select({label, v, options, help, highlight}) {
  return (
    <div>
      <div style={{...h2.mono, fontSize:9.5, color:h2.subdim, letterSpacing:'0.20em',
        textTransform:'uppercase', marginBottom:6}}>{label}</div>
      <div style={{padding:'9px 12px', borderRadius:8,
        border: highlight ? '1px solid rgba(164,168,255,0.32)' : '1px solid rgba(255,255,255,0.06)',
        background: highlight ? 'rgba(164,168,255,0.06)' : 'rgba(255,255,255,0.03)',
        display:'flex', justifyContent:'space-between', alignItems:'center',
        fontSize:12.5, color:highlight ? h2.accent : h2.hi}}>
        <span style={h2.mono}>{v}</span>
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:0.6}}>
          <path d="M2.5 4l3 3 3-3"/></svg>
      </div>
      {help && <div style={{fontSize:10.5, color:h2.dim, marginTop:6, lineHeight:1.5}}>{help}</div>}
    </div>
  );
}

// ── Hero (closed) ──────────────────────────────────────────────────────
function HybridV2Hero() {
  return (
    <div style={{position:'absolute', inset:0, background:h2.bg, color:h2.text,
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

      <H2TopBar/>
      <H2Selector active="Earth"/>
      <HyCompass/>
      <HyScaleBar/>
      <H2LeftRail active={1}/>

      <div style={{position:'absolute', top:134, right:24, width:316, display:'flex',
        flexDirection:'column', gap:12, bottom:114, overflow:'hidden'}}>
        <HyBodyCard/>
        <HyEventLog/>
      </div>

      <HyTimeline/>
    </div>
  );
}

// ── Drawer open state ──────────────────────────────────────────────────
function HybridV2Open() {
  return (
    <div style={{position:'absolute', inset:0, background:h2.bg, color:h2.text,
      fontFamily:"'Inter',system-ui,sans-serif", fontSize:13, overflow:'hidden'}} className="ab-root">
      <div className="starfield" style={{opacity:0.35, filter:'hue-rotate(20deg) brightness(0.85)'}}/>
      <Scene orbitColor="rgba(164,168,255,0.05)" trailColor="rgba(164,168,255,0.22)" />

      {/* Dim scrim over canvas to focus drawer */}
      <div style={{position:'absolute', inset:0, background:'rgba(5,6,12,0.35)',
        backdropFilter:'blur(2px)'}}/>

      <HyGhost x={SCENE.bodies.MARS.x} y={SCENE.bodies.MARS.y} name="Mars" sub="1.382 AU"/>
      <HyGhost x={SCENE.bodies.JUPITER.x} y={SCENE.bodies.JUPITER.y} name="Jupiter" sub="5.20 AU"/>
      <HyGhost x={SCENE.bodies.SATURN.x} y={SCENE.bodies.SATURN.y} name="Saturn" sub="9.58 AU"/>

      <H2TopBar configOpen/>
      <H2Selector active="Earth"/>
      <H2LeftRail active={1}/>
      <H2Drawer/>

      {/* Right column kept but faded — context preserved */}
      <div style={{position:'absolute', top:134, right:24, width:316, display:'flex',
        flexDirection:'column', gap:12, bottom:114, overflow:'hidden', opacity:0.55}}>
        <HyBodyCard/>
      </div>

      <HyTimeline/>
    </div>
  );
}

window.HybridV2Hero = HybridV2Hero;
window.HybridV2Open = HybridV2Open;
