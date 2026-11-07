/* Procedural layered clouds and depth-scaled rain. No video or external assets. */
(() => {
  const canvas = document.querySelector('.home-weather');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let width=0, height=0, frame=0, last=0, time=0, drops=[];
  // Build a small, softly edged fractal cloud texture once, then move the layers.
  const cloud=document.createElement('canvas'); cloud.width=384; cloud.height=192;
  const cloudCtx=cloud.getContext('2d');
  if (!cloudCtx) return;
  const pixels=cloudCtx.createImageData(cloud.width,cloud.height);
  const hash=(x,y)=>{ const n=Math.sin(x*127.1+y*311.7)*43758.5453; return n-Math.floor(n); };
  const noise=(x,y)=>{
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
    return (hash(ix,iy)*(1-u)+hash(ix+1,iy)*u)*(1-v)+(hash(ix,iy+1)*(1-u)+hash(ix+1,iy+1)*u)*v;
  };
  for(let y=0;y<192;y++) for(let x=0;x<384;x++) {
    let n=0,a=.55,f=1;
    for(let o=0;o<5;o++){n+=noise(x/85*f,y/55*f)*a; f*=2; a*=.5;}
    const edge=Math.pow(Math.sin(Math.PI*x/384)*Math.sin(Math.PI*y/192),.8);
    const density=Math.min(1,Math.max(0,(n-.3)*2.2));
    const i=(y*384+x)*4, shade=155+Math.round(n*70);
    pixels.data[i]=shade; pixels.data[i+1]=shade+5; pixels.data[i+2]=shade+6;
    pixels.data[i+3]=Math.round(density*edge*145);
  }
  cloudCtx.putImageData(pixels,0,0);
  function resize(){
    width=innerWidth; height=innerHeight;
    const ratio=Math.min(devicePixelRatio||1,1.5);
    canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
    ctx.setTransform(ratio,0,0,ratio,0,0);
    drops=Array.from({length:width<600?45:100},()=>({x:Math.random()*width,y:Math.random()*height,z:.25+Math.random()*.75}));
    draw(0);
  }
  function draw(dt){
    ctx.clearRect(0,0,width,height);
    const light=document.documentElement.dataset.theme==='light';
    // Different velocities and scales create distant cloud banks and closer mist.
    for(let i=0;i<3;i++) {
      const w=width*(1.3+i*.25),h=Math.min(height*.65,500+i*80);
      const drift=Math.sin(time/(65+i*30)+i*2)*width*.24;
      ctx.globalAlpha=light?.18:.22;
      ctx.drawImage(cloud,-width*.3+drift,-h*.28+i*height*.22,w,h);
    }
    // Rain has a consistent wind direction, with nearer drops longer and faster.
    if(!reduced.matches) for(const d of drops){
      d.x-=dt*(22+35*d.z); d.y+=dt*(340+460*d.z);
      if(d.y>height+30){d.y=-30;d.x=Math.random()*(width+80);}
      if(d.x < -30)d.x=width+20;
      ctx.globalAlpha=(light?.17:.22)*d.z;
      ctx.strokeStyle=light?'#405f5b':'#c6dbd8';ctx.lineWidth=.45+.65*d.z;
      ctx.beginPath();ctx.moveTo(d.x,d.y);ctx.lineTo(d.x-1.4-2*d.z,d.y+8+17*d.z);ctx.stroke();
    }
    ctx.globalAlpha=1;
  }
  function tick(now){
    frame=0;
    if(reduced.matches||document.hidden)return;
    if(now-last>=32){const dt=last?Math.min((now-last)/1000,.07):0;last=now;time+=dt;draw(dt);}
    frame=requestAnimationFrame(tick);
  }
  function sync(){
    cancelAnimationFrame(frame);frame=0;last=0;
    const stopped=reduced.matches;
    document.body.dataset.motion=stopped?'paused':'running';
    window.dispatchEvent(new Event('ronn-motion-change'));
    draw(0);
    if(!stopped&&!document.hidden)frame=requestAnimationFrame(tick);
  }
  reduced.addEventListener('change',sync);
  document.addEventListener('visibilitychange',sync);
  new MutationObserver(()=>draw(0)).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  let resizeFrame=0;
  window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(resize);},{passive:true});
  resize();sync();
})();
