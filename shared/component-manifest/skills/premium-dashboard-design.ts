/**
 * Premium Dashboard Design Skill — base044-inspired dark-mode SaaS aesthetic
 *
 * Comprehensive design system for generating agency-quality dashboards
 * in sandbox components. Covers tokens, patterns, typography, charts, and
 * a complete working template.
 */

export const PREMIUM_DASHBOARD_DESIGN_SKILL = {
  name: "premium-dashboard-design",
  description:
    "Agency-quality dark dashboard design system — design tokens, CSS patterns, typography, chart styling, and a complete template (base044-inspired)",
  content: `## Premium Dashboard Design System

A complete design system for building ultra-polished dark-mode SaaS dashboards in sandbox components. Inspired by top design agencies (base044 aesthetic).

### Design Tokens (CSS Custom Properties)

Paste this \`:root\` block into your sandbox CSS. All patterns below reference these tokens.

\`\`\`css
:root {
  /* Backgrounds (elevation scale — lighter = higher) */
  --bg-base: #0A0A0F;
  --bg-surface-1: #111118;
  --bg-surface-2: #1A1A24;
  --bg-surface-3: #232330;

  /* Borders */
  --border-subtle: rgba(255,255,255,0.06);
  --border-medium: rgba(255,255,255,0.10);
  --border-accent: rgba(124,58,237,0.4);

  /* Text */
  --text-primary: rgba(255,255,255,0.92);
  --text-secondary: rgba(255,255,255,0.55);
  --text-muted: rgba(255,255,255,0.30);

  /* Accents */
  --purple: #7C3AED; --purple-glow: rgba(124,58,237,0.15);
  --cyan: #06B6D4;   --cyan-glow: rgba(6,182,212,0.15);
  --emerald: #10B981; --emerald-glow: rgba(16,185,129,0.15);
  --amber: #F59E0B;  --amber-glow: rgba(245,158,11,0.15);
  --rose: #F43F5E;   --rose-glow: rgba(244,63,94,0.15);

  /* Gradients */
  --gradient-accent: linear-gradient(135deg, #7C3AED, #A855F7);
  --gradient-cyan: linear-gradient(135deg, #06B6D4, #22D3EE);
  --gradient-surface: linear-gradient(180deg, var(--bg-surface-2), var(--bg-surface-1));

  /* Spacing */
  --space-card: 24px;
  --space-section: 32px;
  --radius: 16px;
}
\`\`\`

### Typography Scale

| Role | Size | Weight | Letter-spacing | Color |
|------|------|--------|---------------|-------|
| Page title | 28px | 700 | -0.02em | --text-primary |
| Section heading | 18px | 600 | -0.01em | --text-primary |
| Card title | 14px | 600 | 0 | --text-primary |
| KPI number | 36px | 600 | -0.02em | gradient text |
| Body | 14px | 400 | 0 | --text-secondary |
| Caption / label | 12px | 500 | 0.04em | --text-muted, uppercase |
| Overline | 11px | 600 | 0.06em | --text-muted, uppercase |

### CSS Patterns (copy-paste ready)

**1. Page background with ambient glow:**
\`\`\`css
body {
  margin: 0;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}
.page {
  min-height: 100vh;
  background:
    radial-gradient(ellipse 80% 60% at 20% 10%, var(--purple-glow), transparent),
    radial-gradient(ellipse 60% 50% at 80% 80%, var(--cyan-glow), transparent),
    var(--bg-base);
}
\`\`\`

**2. Card / surface:**
\`\`\`css
.card {
  background: var(--bg-surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  padding: var(--space-card);
}
.card:hover { border-color: var(--border-medium); }
\`\`\`

**3. Gradient KPI number:**
\`\`\`css
.kpi-value {
  font-size: 36px; font-weight: 600; letter-spacing: -0.02em;
  background: var(--gradient-accent);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}
\`\`\`

**4. Trend badge:**
\`\`\`css
.trend-up { color: var(--emerald); background: var(--emerald-glow); }
.trend-down { color: var(--rose); background: var(--rose-glow); }
.trend { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:6px; font-size:12px; font-weight:600; }
\`\`\`

**5. Subtle table rows:**
\`\`\`css
.table-row {
  display: grid; padding: 12px 16px; border-bottom: 1px solid var(--border-subtle);
  font-size: 13px; color: var(--text-secondary); transition: background 0.15s;
}
.table-row:hover { background: rgba(255,255,255,0.02); }
.table-header { color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
\`\`\`

**6. Accent glow button:**
\`\`\`css
.btn-accent {
  background: var(--gradient-accent); color: #fff; border: none;
  padding: 10px 20px; border-radius: 10px; font-weight: 600; font-size: 13px;
  cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;
  box-shadow: 0 0 20px var(--purple-glow);
}
.btn-accent:hover { transform: scale(1.02); box-shadow: 0 0 30px rgba(124,58,237,0.3); }
\`\`\`

### Chart Styling (Chart.js in sandbox)

\`\`\`js
// Gradient area fill
var gradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
gradient.addColorStop(0, 'rgba(124,58,237,0.25)');
gradient.addColorStop(1, 'rgba(124,58,237,0)');

// Chart.js dataset config
{ borderColor: '#7C3AED', backgroundColor: gradient, fill: true,
  borderWidth: 2, tension: 0.4, pointRadius: 0, pointHoverRadius: 5,
  pointBackgroundColor: '#7C3AED' }

// Axes & grid
scales: {
  x: { grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
       ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 11 } } },
  y: { grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
       ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 11 } } }
}

// Tooltip
plugins: { tooltip: {
  backgroundColor: '#1A1A24', titleColor: '#fff', bodyColor: 'rgba(255,255,255,0.7)',
  borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, cornerRadius: 10,
  padding: 12, titleFont: { weight: '600' }
}}

// Data series palette (use in order)
var PALETTE = ['#7C3AED','#06B6D4','#10B981','#F59E0B','#F43F5E','#A855F7'];
\`\`\`

### Complete Dashboard Template

A full working sandbox with 4 KPI cards, area chart, data table, and activity feed. Use as a starting point — swap data and colors as needed.

\`\`\`json
{"component":"sandbox","props":{"title":"Analytics Dashboard","height":720,"libraries":["https://cdn.tailwindcss.com/3.4.1","https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"],"css":":root{--bg:#0A0A0F;--s1:#111118;--s2:#1A1A24;--brd:rgba(255,255,255,0.06);--t1:rgba(255,255,255,0.92);--t2:rgba(255,255,255,0.55);--t3:rgba(255,255,255,0.30);--purple:#7C3AED;--cyan:#06B6D4;--emerald:#10B981;--rose:#F43F5E}*{margin:0;box-sizing:border-box}body{background:var(--bg);color:var(--t1);font-family:Inter,system-ui,sans-serif}.page{min-height:100vh;padding:32px;background:radial-gradient(ellipse 80% 60% at 15% 5%,rgba(124,58,237,0.08),transparent),radial-gradient(ellipse 60% 50% at 85% 90%,rgba(6,182,212,0.06),transparent),var(--bg)}.card{background:var(--s1);border:1px solid var(--brd);border-radius:16px;padding:24px}.kpi-val{font-size:32px;font-weight:600;letter-spacing:-0.02em;background:linear-gradient(135deg,var(--purple),#A855F7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}.trend{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600}.up{color:var(--emerald);background:rgba(16,185,129,0.12)}.down{color:var(--rose);background:rgba(244,63,94,0.12)}.label{font-size:12px;font-weight:500;color:var(--t3);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px}.th{font-size:11px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:0.06em;padding:10px 16px}.tr{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;padding:12px 16px;border-bottom:1px solid var(--brd);font-size:13px;color:var(--t2);transition:background .15s}.tr:hover{background:rgba(255,255,255,0.02)}","html":"<div class='page'><div class='flex items-center justify-between mb-8'><div><h1 style='font-size:28px;font-weight:700;letter-spacing:-0.02em'>Analytics Overview</h1><p style='color:var(--t3);font-size:14px;margin-top:4px'>Real-time performance metrics</p></div></div><div class='grid grid-cols-4 gap-5 mb-6' id='kpis'></div><div class='grid grid-cols-3 gap-5'><div class='col-span-2 card'><div class='flex items-center justify-between mb-5'><span style='font-size:14px;font-weight:600'>Revenue Trend</span><div class='flex gap-1' id='chart-tabs'></div></div><canvas id='chart' height='260'></canvas></div><div class='card flex flex-col'><span style='font-size:14px;font-weight:600;margin-bottom:16px'>Recent Activity</span><div id='feed' class='flex-1 overflow-y-auto space-y-3'></div></div></div><div class='card mt-5'><div class='flex items-center justify-between mb-4'><span style='font-size:14px;font-weight:600'>Top Customers</span></div><div class='th' style='display:grid;grid-template-columns:2fr 1fr 1fr 1fr'>Customer<span>Revenue</span><span>Growth</span><span>Status</span></div><div id='table'></div></div></div>","js":"var kpis=[{label:'Total Revenue',value:'$128.4K',trend:'+12.5%',up:true,gradient:'linear-gradient(135deg,#7C3AED,#A855F7)'},{label:'Active Users',value:'8,429',trend:'+23.1%',up:true,gradient:'linear-gradient(135deg,#06B6D4,#22D3EE)'},{label:'Conversion',value:'3.24%',trend:'-0.8%',up:false,gradient:'linear-gradient(135deg,#10B981,#34D399)'},{label:'Avg Order',value:'$64.20',trend:'+5.3%',up:true,gradient:'linear-gradient(135deg,#F59E0B,#FBBF24)'}];var kC=document.getElementById('kpis');kpis.forEach(function(k,i){var d=document.createElement('div');d.className='card';d.style.opacity='0';d.style.animation='fadeUp 0.4s ease '+(i*80)+'ms forwards';d.innerHTML='<div class=\"label\">'+k.label+'</div><div style=\"font-size:32px;font-weight:600;letter-spacing:-0.02em;background:'+k.gradient+';-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:8px\">'+k.value+'</div><span class=\"trend '+(k.up?'up':'down')+'\">'+(k.up?'\\u2191':'\\u2193')+' '+k.trend+'</span>';kC.appendChild(d)});var style=document.createElement('style');style.textContent='@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}';document.head.appendChild(style);var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];var rev=[42,48,51,49,58,67,72,68,78,85,92,98];var cost=[28,30,32,31,35,38,40,37,42,45,48,52];var cvs=document.getElementById('chart');var cx=cvs.getContext('2d');var g1=cx.createLinearGradient(0,0,0,260);g1.addColorStop(0,'rgba(124,58,237,0.25)');g1.addColorStop(1,'rgba(124,58,237,0)');var g2=cx.createLinearGradient(0,0,0,260);g2.addColorStop(0,'rgba(6,182,212,0.15)');g2.addColorStop(1,'rgba(6,182,212,0)');new Chart(cx,{type:'line',data:{labels:months,datasets:[{label:'Revenue',data:rev,borderColor:'#7C3AED',backgroundColor:g1,fill:true,borderWidth:2,tension:0.4,pointRadius:0,pointHoverRadius:5,pointBackgroundColor:'#7C3AED'},{label:'Costs',data:cost,borderColor:'#06B6D4',backgroundColor:g2,fill:true,borderWidth:2,tension:0.4,pointRadius:0,pointHoverRadius:5,pointBackgroundColor:'#06B6D4',borderDash:[5,5]}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:'bottom',labels:{color:'rgba(255,255,255,0.4)',font:{size:11},padding:20,usePointStyle:true,pointStyleWidth:8}},tooltip:{backgroundColor:'#1A1A24',titleColor:'#fff',bodyColor:'rgba(255,255,255,0.7)',borderColor:'rgba(255,255,255,0.1)',borderWidth:1,cornerRadius:10,padding:12}},scales:{x:{grid:{color:'rgba(255,255,255,0.04)',drawBorder:false},ticks:{color:'rgba(255,255,255,0.3)',font:{size:11}}},y:{grid:{color:'rgba(255,255,255,0.04)',drawBorder:false},ticks:{color:'rgba(255,255,255,0.3)',font:{size:11},callback:function(v){return '$'+v+'K'}}}}}});var activity=[{text:'New enterprise deal closed',time:'2m ago',color:'#10B981'},{text:'Dashboard export completed',time:'15m ago',color:'#06B6D4'},{text:'Payment processed #4821',time:'1h ago',color:'#7C3AED'},{text:'Alert: CPU spike on us-east',time:'2h ago',color:'#F59E0B'},{text:'User onboarding milestone',time:'3h ago',color:'#A855F7'}];var feed=document.getElementById('feed');activity.forEach(function(a){var d=document.createElement('div');d.style.cssText='display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04)';d.innerHTML='<div style=\"width:8px;height:8px;border-radius:50%;background:'+a.color+';margin-top:5px;flex-shrink:0\"></div><div><div style=\"font-size:13px;color:var(--t2)\">'+a.text+'</div><div style=\"font-size:11px;color:var(--t3);margin-top:2px\">'+a.time+'</div></div>';feed.appendChild(d)});var rows=[['Acme Corporation','$24,500','+18.2%','Active'],['Globex Industries','$19,200','+12.7%','Active'],['Initech Systems','$15,800','-3.1%','At Risk'],['Umbrella Corp','$12,400','+8.9%','Active'],['Stark Industries','$10,100','+22.5%','Active']];var table=document.getElementById('table');rows.forEach(function(r){var d=document.createElement('div');d.className='tr';var statusColor=r[3]==='Active'?'var(--emerald)':'var(--rose)';d.innerHTML='<span style=\"color:var(--t1);font-weight:500\">'+r[0]+'</span><span>'+r[1]+'</span><span style=\"color:'+(r[2].startsWith('+')?'var(--emerald)':'var(--rose)')+'\">'+r[2]+'</span><span style=\"color:'+statusColor+'\">'+r[3]+'</span>';table.appendChild(d)})"},"layout_hint":"full-width"}
\`\`\`

### Adaptation Rules

**Swap accent colors:** Replace \`--purple\` values with any accent. Common combos:
- Purple/Cyan (default): \`#7C3AED\` + \`#06B6D4\` — tech/SaaS
- Emerald/Teal: \`#10B981\` + \`#14B8A6\` — finance/health
- Amber/Orange: \`#F59E0B\` + \`#F97316\` — commerce/energy
- Rose/Pink: \`#F43F5E\` + \`#EC4899\` — social/creative

**Add/remove sections:** The template uses CSS Grid. Change \`grid-cols-3\` to \`grid-cols-2\` for fewer columns. Add new \`.card\` divs for extra sections.

**Responsive:** Use \`@media(max-width:768px){.grid{grid-template-columns:1fr !important}}\` for mobile.

**Light mode variant:** Invert the elevation scale:
\`\`\`css
--bg-base: #F8F9FA; --bg-surface-1: #FFFFFF; --bg-surface-2: #F1F3F5;
--border-subtle: rgba(0,0,0,0.06); --text-primary: rgba(0,0,0,0.87);
--text-secondary: rgba(0,0,0,0.55); --text-muted: rgba(0,0,0,0.30);
\`\`\`
Keep accents unchanged — they work on both dark and light backgrounds.

**Chart.js tips:**
- Always use \`pointRadius: 0\` (show on hover only) for clean lines
- Use \`tension: 0.4\` for smooth curves, \`0\` for sharp data
- Gradient fills: top stop at 20-25% opacity, bottom at 0%
- Grid lines: \`rgba(255,255,255,0.04)\` — almost invisible
- Keep legend at bottom with \`usePointStyle: true\` for dot indicators`,
};
