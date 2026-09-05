(function (root) {
  'use strict';
  const ok = x => typeof x === 'number' && Number.isFinite(x);
  const num = x => ok(x) ? x : NaN;
  function neural(values, model) {
    let z = values.map((x,i) => ((ok(x) ? x : model.impute[i]) - model.mean[i]) / model.scale[i]);
    model.weights.forEach((w,l) => {
      let next = model.biases[l].slice();
      for (let i=0;i<z.length;i++) for (let j=0;j<next.length;j++) next[j] += z[i]*w[i][j];
      z = l === model.weights.length-1 ? next : next.map(v=>Math.max(0,v));
    });
    return z[0];
  }
  function boost(values, model) {
    let y=model.initial;
    for (const t of model.trees) {
      let n=0;
      while(t.left[n]!==-1) n=Math.fround(values[t.feature[n]])<=t.threshold[n]?t.left[n]:t.right[n];
      y+=model.rate*t.value[n];
    }
    return y;
  }
  function heatFeatures(r,c) {
    const f={...r};
    f.Dt_mass_tph=num(r.D0)-num(r.Dsp)-c.DKPU_tph;
    f.hfg_kcal_kg=(2500.9-2.36*num(r.TcPSG))/4.1868;
    f.Qt_physics_Gcal_h=f.Dt_mass_tph*f.hfg_kcal_kg/1000;
    f.Qelectric_Gcal_h=.86*num(r.N)/c.eta_em;
    f.QKPU_water_proxy_Gcal_h=num(r.GsuvEG)*(num(r.Tr_KPU)-num(r.TsuvEG))/1000;
    return f;
  }
  function steamFeatures(r,c) {
    const f={...r};
    const h0=(2500.9+1.82*num(r.T0))/4.1868;
    const hsp=(2500.9+1.82*num(r.Tsp))/4.1868;
    const ht=(1-c.moisture)*(2500.9+1.82*(num(r.Tsob1)+num(r.Tsob2))/2)/4.1868;
    const hk=(2500.9+1.82*num(r.TsKPU))/4.1868;
    const d=h0-ht;
    f.D0_energy_proxy=d>20?(num(r.Dsp)*(hsp-ht)+c.DKPU*(hk-ht)+860*num(r.N)/c.eta_em)/d:NaN;
    if(f.D0_energy_proxy<=0) f.D0_energy_proxy=NaN;
    return f;
  }
  function predict(r,models) {
    const hf=heatFeatures(r,models.heat.constants), sf=steamFeatures(r,models.steam.constants);
    let qvalid=models.heat.features.every(k=>ok(hf[k])) && hf.Dt_mass_tph>0 && num(r.D0)>50 && num(r.N)>5;
    let dvalid=models.steam.features.every(k=>ok(sf[k])) && num(r.N)>5;
    const qcor=qvalid?neural(models.heat.features.map(k=>hf[k]),models.heat.model):NaN;
    const dcor=dvalid?boost(models.steam.features.map(k=>sf[k]),models.steam.model):NaN;
    const qvirt=hf.Qt_physics_Gcal_h+qcor, dvirt=sf.D0_energy_proxy+dcor;
    qvalid=qvalid&&ok(qvirt);dvalid=dvalid&&ok(dvirt);
    const qref=num(r.GrPSG)*(num(r.Tr_PSG)-num(r.TrPSG))/1000;
    const reference_valid=ok(qref)&&num(r.GrPSG)>0&&num(r.Tr_PSG)>num(r.TrPSG);
    const qres=qref-qvirt-models.heat.rule.center, dres=num(r.D0)-dvirt-models.steam.rule.center;
    const applicable=num(r.G_HOV)>=400 && num(r.N)>5;
    const observers=Object.entries(models.observers).map(([tag,o])=>{
      const available=o.usable && qvalid && applicable && ok(r[tag]);
      const pred=qvalid?boost(models.heat.features.map((k,i)=>ok(hf[k])?hf[k]:o.impute[i]),o.model):NaN;
      const centered=num(r[tag])-pred-o.rule.center;
      return {tag,pred,centered,score:Math.abs(centered)/o.rule.threshold,threshold:o.rule.threshold,
              available,alert:available&&Math.abs(centered)>o.rule.threshold,unit:tag==='GrPSG'?'t/h':'°C'};
    });
    observers.push({tag:'D0',pred:dvirt,centered:dres,score:Math.abs(dres)/models.steam.rule.threshold,
                    threshold:models.steam.rule.threshold,available:dvalid&&applicable&&ok(r.D0),
                    alert:dvalid&&applicable&&Math.abs(dres)>models.steam.rule.threshold,unit:'t/h'});
    return {qphys:hf.Qt_physics_Gcal_h,qcor,qvirt,qref,qres,dphys:sf.D0_energy_proxy,dcor,dvirt,dres,
            qvalid,dvalid,reference_valid,applicable,hfg:hf.hfg_kcal_kg,observers,
            qalert:qvalid&&reference_valid&&applicable&&Math.abs(qres)>models.heat.rule.threshold,
            calert:qvalid&&applicable&&Math.abs(qcor)>models.heat.correction_threshold,
            dalert:dvalid&&applicable&&Math.abs(dres)>models.steam.rule.threshold,
            dcAlert:dvalid&&applicable&&Math.abs(dcor)>models.steam.correction_threshold};
  }
  function inject(r,tag,amount) {
    const v={...r};
    if(tag==='GrPSG'||tag==='D0') v[tag]=num(v[tag])*(1+amount/100);
    if(tag==='Tr_PSG'||tag==='TrPSG') v[tag]=num(v[tag])+amount;
    return v;
  }
  function costs(r,p,a) {
    const valid=[a.efficiency,a.lhv,a.price,a.hfw].every(ok)&&a.efficiency>0&&a.efficiency<=1&&a.lhv>0&&a.price>=0&&a.hfw>=0;
    const h0=2500.9+1.82*num(r.T0);
    const deltaH=h0-a.hfw;
    if(!valid||!ok(deltaH)||deltaH<=0||!p.dvalid) return {valid:false};
    const fuelPerSteam=deltaH/(1000*a.efficiency*a.lhv),costPerSteam=fuelPerSteam*a.price;
    const deq=p.hfg>0?p.qcor*1000/p.hfg:NaN;
    return {valid:true,h0,deltaH,fuelPerSteam,costPerSteam,
            fuelPred:p.dvirt*fuelPerSteam,costPred:p.dvirt*costPerSteam,
            costPhysics:p.dphys*costPerSteam,costFromD0:num(r.D0)*costPerSteam,
            difference:(num(r.D0)-p.dvirt)*costPerSteam,
            steamCorrectionCost:p.dcor*costPerSteam,heatEquivalentSteam:deq,
            heatEquivalentCost:deq*costPerSteam};
  }
  const api={neural,boost,heatFeatures,steamFeatures,predict,inject,costs};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  root.CHPEngine=api;
})(typeof window!=='undefined'?window:globalThis);
