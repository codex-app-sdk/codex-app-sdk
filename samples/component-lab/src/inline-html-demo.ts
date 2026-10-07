// Split tags and a script: interaction with the first chunk must survive.
export const inlineHtmlChunks = [
  `<artifact title="Weekend planner"><!doctype html><html><head><style>
  body { margin:0; padding:24px; background:#f5f5f0; color:#21372d; font:15px system-ui; }
  h1 { margin:6px 0 18px; font-size:28px; } p { color:#52665a; }
  input, button { font:inherit; border:1px solid #9db3a5; border-radius:8px; padding:9px 12px; }
  button { background:#224f39; color:white; cursor:pointer; } input { background:white; color:#21372d; }
  .grid { display:flex; flex-wrap:wrap; gap:12px; margin-top:20px; }
  article { flex:1; min-width:140px; border-radius:12px; padding:16px; background:white; }
  small { text-transform:uppercase; letter-spacing:2px; }
  </style></head><body><small>Interactive HTML · live preview</small><h1>A little room to explore.</h1>
  <p>Type a destination and click while the rest streams. Your changes should stay put.</p>
  <input aria-label="Destination" placeholder="Your next destination"><button id="counter">0 visits</button>
  <script>window.runs=(window.runs||0)+1;let visits=0;document.querySelector('#counter').onclick=()=>{document.querySelector('#counter').textContent=(++visits)+' visits'};</script>`,
  '<section class="grid"><art',
  'icle><small>01 · Wander</small><h2>Take the slow road.</h2><p>Leave an afternoon unplanned.</p></article>',
  '<article><small>02 · Discover</small><h2>Find your corner.</h2><p>Good coffee. A book. No rush.</p></article></section><scr',
  'ipt>document.body.dataset.finished="yes";</script></body></html>\n</art',
  'ifact>',
]

export const chartHtmlChunks = [
  `<artifact title="Chart.js · Weekly activity"><!doctype html><html><head><style>
  body { margin:0; padding:20px; color:#253449; background:#fafbfe; font:14px system-ui; }
  header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  h2 { margin:0; font-size:20px; } p { color:#68778d; }
  button { border:1px solid #c5d0e2; border-radius:7px; background:white; color:#253449; padding:7px 12px; cursor:pointer; }
  .chart { height:230px; } #status { font-size:12px; }
  </style></head><body><header><h2>Small steps, steady progress</h2><button id="toggle" disabled>Show line chart</button></header>
  <p>Illustrative weekly activity · hover over a day or switch chart type.</p>
  <div class="chart"><canvas id="activity" aria-label="Weekly activity chart" role="img"></canvas></div>
  <p id="status">Loading Chart.js from HTTPS…</p>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js" crossorigin="anonymous" referrerpolicy="no-referrer" onerror="document.querySelector('#status').textContent='Could not load Chart.js. Check your connection or host CSP.'"></script>`,
  `<script>
  if (typeof Chart !== 'undefined') {
    const chart = new Chart(document.querySelector('#activity'), {
      type:'bar',
      data:{labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], datasets:[{label:'Completed tasks',data:[8,12,10,17,14,6,9],backgroundColor:'#7089ef',borderColor:'#5975df',borderWidth:2,borderRadius:5,tension:0.35}]},
      options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'#e8edf5'}},x:{grid:{display:false}}}}
    });
    const toggle=document.querySelector('#toggle'); toggle.disabled=false;
    toggle.onclick=()=>{chart.config.type=chart.config.type==='bar'?'line':'bar';chart.update();toggle.textContent=chart.config.type==='bar'?'Show line chart':'Show bar chart'};
    document.querySelector('#status').textContent='Chart.js '+Chart.version+' · sandboxed HTTPS library';
  }
  </script>`,
  '</body></html>\n</artifact>',
]
