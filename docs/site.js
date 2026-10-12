const checks=[...document.querySelectorAll('.demo-grid input')];
function update(){const count=checks.filter(c=>c.checked).length;document.getElementById('demo-count').textContent=`${count} / ${checks.length} selected`;}
checks.forEach(c=>c.addEventListener('change',update));
document.getElementById('select-all').onclick=()=>{checks.forEach(c=>c.checked=true);update();};
document.getElementById('select-none').onclick=()=>{checks.forEach(c=>c.checked=false);update();};
document.getElementById('copy-address').onclick=async()=>{const status=document.getElementById('copy-status');try{await navigator.clipboard.writeText('chrome://extensions');status.textContent='Copied. Paste it into Chrome’s address bar.';}catch{status.textContent='Type chrome://extensions in Chrome’s address bar.';}};
