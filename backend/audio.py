import io
import numpy as np
import soundfile as sf
from scipy import signal, ndimage

def repair_audio(data: bytes, reduction: float=0.5, normalize: bool=True):
    """Conservative spectral subtraction with no timing changes. Not source separation."""
    info=sf.info(io.BytesIO(data))
    if info.duration>600 or info.channels>2 or info.samplerate<1000 or info.samplerate>192000: raise ValueError('支持最长 10 分钟、1–2 声道、1–192 kHz 音频')
    x,sr=sf.read(io.BytesIO(data),dtype='float64',always_2d=True)
    if len(x)==0 or len(x)/sr>600 or x.shape[1]>2: raise ValueError('支持最长 10 分钟的单/双声道音频')
    if not np.isfinite(x).all(): raise ValueError('音频包含无效采样')
    before=float(np.max(np.abs(x)))
    clipped=int(np.sum(np.abs(x)>=0.999))
    x=x-np.mean(x,axis=0,keepdims=True)
    sos=signal.butter(2,25,fs=sr,btype='highpass',output='sos')
    if len(x)>32: x=signal.sosfiltfilt(sos,x,axis=0)
    if reduction>0 and len(x)>=1024:
        for ch in range(x.shape[1]):
            _,_,z=signal.stft(x[:,ch],fs=sr,nperseg=1024,noverlap=768)
            mag=np.abs(z)
            noise=np.quantile(mag,0.15,axis=1,keepdims=True)
            gain=np.clip(1-reduction*noise/(mag+1e-12),0.15,1)
            gain=ndimage.uniform_filter(gain,size=(3,3))
            _,out=signal.istft(z*gain,fs=sr,nperseg=1024,noverlap=768)
            x[:,ch]=out[:len(x)]
    peak=float(np.max(np.abs(x)))
    if normalize and peak>1e-8: x *= (10**(-1/20))/peak
    x=np.clip(x,-10**(-1/20),10**(-1/20))
    output=io.BytesIO(); sf.write(output,x,sr,format='WAV',subtype='PCM_24')
    # Peaks in original sample order; never used as a fake spectrogram.
    mono=np.max(np.abs(x),axis=1)
    peaks=[float(np.max(v)) for v in np.array_split(mono,min(320,len(mono))) if len(v)]
    return output.getvalue(), {'sampleRate':sr,'channels':x.shape[1],'duration':len(x)/sr,'frames':len(x),'peakBefore':before,'peakAfter':float(np.max(np.abs(x))),'clippedSamples':clipped,'waveform':peaks,'notice':'已削波信息无法完整恢复；处理不改变采样率和长度。降噪不等于音源分离。'}
