'use strict';
(() => {
  const $=id=>document.getElementById(id), D=window.CHP_DATA, E=window.CHPEngine;
  if(!D||!E){$('fatal').hidden=false;$('fatal').textContent='The data or model did not load. Reload the page; no estimates are available.';return;}
  const fmt=(x,n=2)=>Number.isFinite(x)?x.toLocaleString('en-US',{minimumFractionDigits:n,maximumFractionDigits:n}):'—';
  const signed=(x,n=2)=>Number.isFinite(x)?(x>0?'+':'')+fmt(x,n):'—';
  const put=(id,text)=>{$(id).textContent=text;};
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={index:24,fault:'none',amount:0,tab:'heat',timer:null};
  const original=D.records.map(r=>({row:r,p:E.predict(r,D.models)}));
  let replay=original;
  const stamp=s=>Date.parse(s+'Z'); // display original naive time consistently, without local conversion
  function chart(id,data,series) {
    const W=1000,H=245,pad={l:53,r:18,t:15,b:33};
    const all=data.flatMap(x=>series.map(s=>s.get(x))).filter(Number.isFinite);
    if(!all.length){$(id).textContent='No valid estimates in this window.';return;}
    let lo=Math.min(...all),hi=Math.max(...all),margin=Math.max((hi-lo)*.12,1);
    lo-=margin;hi+=margin;
    const t0=stamp(data[0].row.time),t1=stamp(data.at(-1).row.time),span=t1-t0||3600000;
    const x=t=>pad.l+(stamp(t)-t0)/span*(W-pad.l-pad.r),y=v=>H-pad.b-(v-lo)/(hi-lo)*(H-pad.t-pad.b);
    let svg=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(id==='heatChart'?'Historical heat estimates in Gcal per hour':'Historical main-steam estimates in tonnes per hour')}">`;
    for(let i=0;i<5;i++){const v=lo+(hi-lo)*i/4,py=y(v);svg+=`<line class="gridline" x1="${pad.l}" x2="${W-pad.r}" y1="${py}" y2="${py}"/><text x="${pad.l-10}" y="${py+4}" text-anchor="end">${fmt(v,0)}</text>`;}
    for(const s of series){let path='',prev=null;for(const pt of data){const v=s.get(pt);if(!Number.isFinite(v)){prev=null;continue;}const gap=prev===null||stamp(pt.row.time)-prev>5400000;path+=`${gap?'M':'L'}${x(pt.row.time).toFixed(2)},${y(v).toFixed(2)} `;prev=stamp(pt.row.time);}svg+=`<path stroke="${s.color}" d="${path}"/>`;const last=data.at(-1),v=s.get(last);if(Number.isFinite(v))svg+=`<circle cx="${x(last.row.time)}" cy="${y(v)}" r="3.5" fill="${s.color}"/>`;}
    for(const [pt,anchor] of [[data[0],'start'],[data.at(-1),'end']])svg+=`<text x="${x(pt.row.time)}" y="${H-6}" text-anchor="${anchor}">${esc(pt.row.time.slice(5,10)+' '+pt.row.time.slice(11,16))}</text>`;
    $(id).innerHTML=svg+'</svg>';
  }
  function assumptions(){return {price:$('price').valueAsNumber,lhv:$('lhv').valueAsNumber,efficiency:$('efficiency').valueAsNumber/100,hfw:$('hfw').valueAsNumber};}
  function updateCosts(r,p){
    const c=E.costs(r,p,assumptions());
    if(!c.valid){put('costPred','Check inputs');put('fuelPred','Use valid boiler and fuel values.');for(const id of ['costReported','costDifference','costCorrection','heatEquivalent','heatEquivalentDetail','planMarginal','planCost','planDCost','planQCost'])put(id,'—');return;}
    put('costPred',fmt(c.costPred,0)+' RUB/h');put('fuelPred',fmt(c.fuelPred,2)+' tonnes of fuel per hour · assumed fuel properties');
    put('costReported',fmt(c.costFromD0,0)+' RUB/h');put('costDifference',signed(c.difference,0)+' RUB/h');put('costCorrection',signed(c.steamCorrectionCost,0)+' RUB/h');
    put('heatEquivalent',signed(c.heatEquivalentSteam)+' t/h equivalent');
    put('heatEquivalentDetail',`${signed(p.qcor)} Gcal/h of heat correction corresponds to ${signed(c.heatEquivalentCost,0)} RUB/h of steam-equivalent fuel cost under the displayed assumptions.`);
    put('planMarginal',fmt(c.costPerSteam,0));put('planCost',fmt(c.costPred,0));
    put('planDCost',signed(c.steamCorrectionCost,0)+' RUB/h fuel-cost effect');
    put('planQCost',signed(c.heatEquivalentCost,0)+' RUB/h steam-equivalent sensitivity');
  }
  function setBar(id,score){$(id).style.width=Math.min(Math.max(score,0)*70,100)+'%';$(id).classList.toggle('exceeded',score>1);}
  function render(){
    const {row:r,p}=replay[state.index],base=original[state.index].row;
    put('date',r.time.slice(0,10));put('hour',r.time.slice(11,16));put('rowinfo',`Observation ${state.index+1} of ${replay.length}`);$('timeline').value=state.index;
    $('previous').disabled=state.index===0;$('next').disabled=state.index===replay.length-1;
    for(const k of ['qref','qphys','qvirt','dphys','dvirt'])put(k,fmt(p[k]));for(const k of ['qcor','dcor'])put(k,signed(p[k]));put('dmeas',fmt(r.D0));
    put('planQ',fmt(p.qvirt));put('planD',fmt(p.dvirt));put('planQCorrection',signed(p.qcor)+' Gcal/h');put('planDCorrection',signed(p.dcor)+' t/h');
    const warn=p.qalert||p.dalert||p.observers.some(o=>o.alert),corr=p.calert;
    let title='Within displayed monitoring limits',detail='No threshold crossing at this hour. This does not certify fault-free operation.',cls='banner';
    if(!p.qvalid||!p.applicable){title='Outside the calibrated operating scope';detail='Alerts are unavailable or suppressed. Check model inputs and operating mode.';cls+=' warning';}
    else if(!p.reference_valid){title='Check the water-side reference';detail='The reference is unavailable or physically invalid. Its residual alert is suppressed.';cls+=' warning';}
    else if(warn){title='Investigate this operating hour';detail='A residual observer exceeds its fixed calibration limit. See the measurement checks below.';cls+=' danger';}
    else if(corr){title='Unusually large learned correction';detail='The required model adjustment is outside its calibration history; no failed sensor has been identified.';cls+=' warning';}
    if(state.fault!=='none')detail='SIMULATED SENSOR ERROR · '+detail;
    $('heatStatus').className=cls;$('heatStatus').innerHTML=`<b>${esc(title)}</b><span>${esc(detail)}</span>`;
    const ct=D.models.heat.correction_threshold, rt=D.models.heat.rule.threshold;
    put('correctionLimit',`Gcal/h · magnitude limit ${fmt(ct,2)}`);put('correctionScore',fmt(Math.abs(p.qcor)/ct,2)+' × limit');setBar('correctionBar',Math.abs(p.qcor)/ct);
    put('correctionReason',`${signed(p.qcor)} Gcal/h adjustment. ${p.calert?'Unusually large for calibration.':'Inside the calibration correction range.'}`);
    put('residualValue',signed(p.qres)+' Gcal/h');setBar('residualBar',Math.abs(p.qres)/rt);
    put('residualReason',`Centered water-reference minus virtual heat. Alert when its magnitude exceeds ${fmt(rt)} Gcal/h.`);
    put('svgD0','D0 '+fmt(r.D0,1)+' t/h');put('svgN','N '+fmt(r.N,1)+' MW');put('svgDsp','Dsp '+fmt(r.Dsp,1)+' t/h');put('svgQ','Q̂ '+fmt(p.qvirt,1)+' Gcal/h');put('svgSupply','SUPPLY '+fmt(r.Tr_PSG,1)+' °C');put('svgReturn','RETURN '+fmt(r.TrPSG,1)+' °C');put('svgFlow','GrPSG '+fmt(r.GrPSG,0)+' t/h');put('svgDt','Dt '+fmt(r.D0-r.Dsp-3.5,1)+' t/h');
    const sorted=p.observers.slice().sort((a,b)=>Number(b.available)-Number(a.available)||(b.score-a.score));
    const leads=sorted.filter(o=>o.alert&&o.available);
    put('candidateLead',leads.length?`Investigation lead${leads.length>1?'s':''}: ${leads.map(o=>o.tag).join(', ')}. Cross-check instruments and shared inputs before assigning the cause.`:'No supported observer currently singles out a measurement. A common-mode error can still be missed.');
    $('observers').innerHTML=sorted.map(o=>`<tr><td><b>${esc(o.tag)}</b><br><span class="small">${esc(o.unit)}</span></td><td>${o.available?fmt(o.score,2)+' ×':'—'}</td><td class="obs-state ${o.available?(o.alert?'bad':'good'):'muted'}">${!o.available?(o.tag==='TrPSG'?'Not validated — excluded':'Unavailable'):o.alert?'Worth investigating':'Within observer limit'}</td></tr>`).join('');
    put('seStatus',`Stored state-estimation status: ${base.SE_status}. ${state.fault==='none'?'Original SCADA hour.':'Not recomputed for the synthetic offset.'}`);
    const se=['D0','Dsp','GrPSG','TrPSG','Tr_PSG'].map(tag=>({tag,z:Math.abs(base['SE_z_'+tag])})).sort((a,b)=>b.z-a.z),sm=Math.max(3.5,...se.map(x=>x.z));
    $('seBars').innerHTML=se.map(({tag,z})=>`<div class="se-row"><span>${tag}</span><span class="sebar"><i style="width:${Math.min(z/sm*100,100)}%"></i></span><span>${fmt(z,2)} σ</span></div>`).join('');
    const history=replay.slice(Math.max(0,state.index-95),state.index+1);
    if(state.tab==='heat')chart('heatChart',history,[{get:x=>x.p.qphys,color:'#8a9ba6'},{get:x=>x.p.qref,color:'#d26520'},{get:x=>x.p.qvirt,color:'#007d79'}]);
    if(state.tab==='steam')chart('steamChart',history,[{get:x=>x.p.dphys,color:'#8a9ba6'},{get:x=>x.row.D0,color:'#d26520'},{get:x=>x.p.dvirt,color:'#007d79'}]);
    put('d0Message',`Centered D0 residual: ${signed(p.dres)} t/h. Limit: ±${fmt(D.models.steam.rule.threshold)} t/h. ${p.dalert?'D0 channel requires investigation.':'Inside the D0 residual limit.'} Learned correction: ${signed(p.dcor)} t/h; correction-magnitude limit ${fmt(D.models.steam.correction_threshold)} t/h (${p.dcAlert?'unusually large':'within calibration range'}). Neither signal determines excess fuel use.`);
    updateCosts(r,p);
  }
  function rebuild(){replay=state.fault==='none'?original:D.records.map(r=>{const row=E.inject(r,state.fault,state.amount);return {row,p:E.predict(row,D.models)};});render();}
  function stop(){if(state.timer)clearInterval(state.timer);state.timer=null;put('play','Play replay');}
  function step(n){state.index=Math.max(0,Math.min(replay.length-1,state.index+n));render();}
  $('previous').onclick=()=>{stop();step(-1);};$('next').onclick=()=>{stop();step(1);};
  $('play').onclick=()=>{if(state.timer){stop();return;}if(state.index===replay.length-1)state.index=0;put('play','Pause replay');state.timer=setInterval(()=>{if(state.index===replay.length-1)stop();else step(1);},1000);};
  $('timeline').oninput=e=>{stop();state.index=Number(e.target.value);render();};
  function updateFault(){const temperature=['TrPSG','Tr_PSG'].includes(state.fault);put('magnitudeText',signed(state.amount,temperature?1:0)+(temperature?' °C':'%'));put('scenarioNote',state.fault==='none'?'Original readings remain unchanged. Synthetic offsets are demonstration tests, not real faults.':`${state.fault} offset applies to every displayed observation. Both models are recomputed; original records and stored SE evidence stay untouched.`);}
  $('fault').onchange=e=>{stop();state.fault=e.target.value;const t=['TrPSG','Tr_PSG'].includes(state.fault);state.amount=state.fault==='GrPSG'?15:10;$('magnitude').min=t?-10:-25;$('magnitude').max=t?10:25;$('magnitude').step=t?.5:1;$('magnitude').value=state.amount;$('faultControls').hidden=state.fault==='none';updateFault();rebuild();};
  let pending=null;$('magnitude').oninput=e=>{state.amount=Number(e.target.value);updateFault();if(pending)cancelAnimationFrame(pending);pending=requestAnimationFrame(()=>{pending=null;rebuild();});};
  $('reset').onclick=()=>{stop();if(pending)cancelAnimationFrame(pending);state.fault='none';state.amount=0;$('fault').value='none';$('faultControls').hidden=true;updateFault();rebuild();};
  const tabs=Array.from(document.querySelectorAll('[data-tab]'));
  function selectTab(btn){state.tab=btn.dataset.tab;for(const b of tabs){const selected=b===btn;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;$(b.dataset.tab).hidden=!selected;}render();}
  tabs.forEach((btn,i)=>{btn.tabIndex=i===0?0:-1;btn.onclick=()=>selectTab(btn);btn.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();let j=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;selectTab(tabs[j]);tabs[j].focus();}};});
  for(const id of ['price','lhv','efficiency','hfw'])$(id).oninput=()=>updateCosts(replay[state.index].row,replay[state.index].p);
  function download(name,payload){const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  $('export').onclick=()=>{const x=replay[state.index];const report={prototype:'CHP Heat Guardian',timestamp:x.row.time,source:'Historical TA-5 replay, not live SCADA',scenario:{sensor:state.fault,offset:state.amount},original_readings:D.records[state.index],scenario_readings:x.row,estimates:x.p,assumptions:assumptions(),economics:E.costs(x.row,x.p,assumptions()),limits:D.models.heat.rule,caveat:'Research investigation hints and assumption-based cost; not fault isolation, measured fuel savings, billing or control.'};const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='CHP_Heat_Guardian_'+x.row.time.slice(0,13).replace(/[:T]/g,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);};
  $('exportMilp').onclick=()=>{const a=assumptions(),horizon=replay.slice(state.index,state.index+24).map(({row,p})=>{const c=E.costs(row,p,a);return {timestamp:row.time,D0_hat_tph:p.dvirt,QT_hat_Gcal_h:p.qvirt,D0_correction_tph:p.dcor,QT_correction_Gcal_h:p.qcor,marginal_steam_cost_RUB_t:c.valid?c.costPerSteam:null,baseline_fuel_cost_RUB_h:c.valid?c.costPred:null,alerts:{D0:p.dalert,QT:p.qalert,correction_D0:p.dcAlert,correction_QT:p.calert}};});download('CHP_MILP_inputs_'+replay[state.index].row.time.slice(0,13).replace(/[:T]/g,'_')+'.json',{schema:'chp-heat-guardian/milp-input/v1',source:'Historical TA-5 replay; corrected forecasts are parameters, not optimized decisions',units:{D0_hat_tph:'t/h',QT_hat_Gcal_h:'Gcal/h',marginal_steam_cost_RUB_t:'RUB/t',baseline_fuel_cost_RUB_h:'RUB/h'},scenario:{sensor:state.fault,offset:state.amount},fuel_assumptions:a,formulation:{continuous_variables:['d_t: main-steam flow','q_t: useful heat','positive/negative forecast-deviation slacks'],binary_variables:['u_t: commitment','y_t: startup'],objective:'fuel + startup + weighted D0/QT forecast deviations',constraints:['steam capacity','heat demand and steam-to-heat coupling','ramp limits','startup logic']},horizon,caveat:'Input handoff only. Plant constraints, uncertainty sets, coefficients, and solver results require engineering validation.'});};
  $('splits').innerHTML=D.summary.split.map(s=>`<div class="split"><strong>${esc(s.Block)}</strong><b>${Number(s.Rows).toLocaleString()}</b><span>observations</span><span>${esc(s.Start)}<br>to ${esc(s.End)}</span></div>`).join('');
  const norm=m=>({RMSE:m.RMSE_Gcal_h,MAE:m.MAE_Gcal_h,bias:m.Bias_pred_minus_true_Gcal_h,R2:m.R2});
  $('metricsTable').innerHTML=[['Heat · physics',norm(D.summary.heat_physics)],['Heat · physics + neural correction',norm(D.summary.heat_hybrid)],['D0 · energy-balance proxy',D.summary.steam_physics],['D0 · proxy + tree correction',D.summary.steam_hybrid]].map(([name,m])=>`<tr><td>${name}</td><td>${fmt(m.RMSE,3)}</td><td>${fmt(m.MAE,3)}</td><td>${signed(m.bias,3)}</td><td>${fmt(m.R2,3)}</td></tr>`).join('');
  put('testSummary',`Unmodified holdout: heat residual alerts ${fmt(D.summary.heat_alert_rate,2)}%; heat-correction warnings ${fmt(D.summary.heat_correction_alert_rate,2)}%; D0 residual alerts ${fmt(D.summary.steam_alert_rate,2)}%. These are unlabelled-baseline alert rates, not proven false-positive rates. The heat model mainly removes bias; its RMSE gain is small and its 95th-percentile error did not improve. Raw H0 and Hsp are missing throughout this holdout, so the new steam and cost modules consistently use explicitly labelled temperature-based enthalpy proxies.`);
  render();
})();
