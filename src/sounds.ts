export const soundKits=[
 {id:'black-pearl',name:'Black Pearl · 朋克摇滚',description:'真实 Pearl 鼓组采样，22 英寸底鼓与 14 英寸军鼓，适合紧凑的朋克律动。'},
 {id:'red-zeppelin',name:'Red Zeppelin · 厚重摇滚',description:'真实 Ludwig 鼓组采样，26 英寸底鼓与大尺寸镲片，声音更厚重、开阔。'},
 {id:'synthetic',name:'原版合成 · 轻量',description:'原来的程序合成鼓声，无需加载采样。'}
] as const;
export type SoundKitId=typeof soundKits[number]['id'];
export function soundKit(value?:string):SoundKitId{return soundKits.some(k=>k.id===value)?value as SoundKitId:'black-pearl'}
export function velocityLayer(velocity:number){return velocity<=26?1:velocity<=52?2:velocity<=77?3:velocity<=102?4:5}
