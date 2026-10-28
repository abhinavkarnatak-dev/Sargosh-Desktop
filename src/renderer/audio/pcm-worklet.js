// Runs on the audio thread. Area resampling preserves duration across 44.1/48 kHz devices.
class SargoshPCM extends AudioWorkletProcessor {
  constructor() {
    super(); this.ratio=sampleRate/16000;this.weight=0;this.sum=0;this.samples=[];this.active=false;
    this.port.onmessage=event=>{
      if(event.data==='start')this.active=true;
      if(event.data==='finish'){this.active=false;this.flush();this.port.postMessage({finished:true});}
    };
  }
  flush(){if(!this.samples.length)return;const bytes=new ArrayBuffer(this.samples.length*2),view=new DataView(bytes);this.samples.forEach((x,i)=>view.setInt16(i*2,x,true));this.samples=[];this.port.postMessage({audio:bytes},[bytes]);}
  process(inputs){
    if(!this.active)return true;
    const channels=inputs[0];if(!channels?.length)return true;
    for(let i=0;i<channels[0].length;i++){
      let value=0;for(const channel of channels)value+=channel[i]/channels.length;
      let remaining=1;
      while(remaining>1e-9){
        const take=Math.min(remaining,this.ratio-this.weight);this.sum+=value*take;this.weight+=take;remaining-=take;
        if(this.weight>=this.ratio-1e-9){const x=Math.max(-1,Math.min(1,this.sum/this.ratio));this.samples.push(Math.round(x*(x<0?32768:32767)));this.sum=0;this.weight=0;if(this.samples.length>=1600)this.flush();}
      }
    }
    return true;
  }
}
registerProcessor('sargosh-pcm',SargoshPCM);
