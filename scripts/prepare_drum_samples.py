"""Build attributed web selections from the official AVL 2023 SFZ packs."""
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile
import soundfile as sf

ROOT=Path(__file__).resolve().parents[1]
SOURCES=ROOT/'.tools/drum-sources'; OUT=ROOT/'public/sounds'
KITS={'black-pearl':'BLACK_PEARL_2023_repack.zip','red-zeppelin':'RED_ZEPPELIN_2023_repack.zip'}
KEYS={'kick':36,'snare':38,'hihat':42,'openhat':48,'tom':45,'floor':41,'crash':49,'ride':51}
SOURCES.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
manifest=[]
for kit,filename in KITS.items():
    archive=SOURCES/filename
    source_url='https://www.bandshed.net/sounds/AVLDrumkits_SFZ/'+filename
    if not archive.exists():
        with urllib.request.urlopen(urllib.request.Request(source_url,headers={'User-Agent':'Mozilla/5.0'})) as response:archive.write_bytes(response.read())
    archive_hash=hashlib.sha256(archive.read_bytes()).hexdigest()
    with zipfile.ZipFile(archive) as z:
        for instrument,key in KEYS.items():
            for layer in range(1,6):
                name=next(n for n in z.namelist() if Path(n).name.startswith(f'{key}-') and n.endswith(f'-{layer}.wav'))
                raw=z.read(name);audio,rate=sf.read(io.BytesIO(raw),always_2d=True)
                # Preserve the recording, channel layout, original rate and full tail.
                target=OUT/kit/f'{instrument}-{layer}.ogg';target.parent.mkdir(exist_ok=True)
                sf.write(target,audio,rate,format='OGG',subtype='VORBIS')
                manifest.append({'kit':kit,'instrument':instrument,'layer':layer,'source':name,'sourceUrl':source_url,'archiveSha256':archive_hash,'sourceSha256':hashlib.sha256(raw).hexdigest(),'file':str(target.relative_to(OUT)),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'sampleRate':rate,'channels':audio.shape[1],'frames':len(audio)})
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
license_text='''AVL-Drumkits
============
Created by: Glen MacArthur 2015
Formats: SFZ, SF2, h2drumkit
Website: https://www.bandshed.net/avldrumkits/
Contact: info@bandshed.net

CC-BY-SA 3.0 with the following exception:
The by-sa condition is imperative if you modify the samples themselves or
create new sample libraries with this licensed product. However, produced
music and other non-sample-library works can be licensed freely.

Attribution means keeping all authors information and this readme-file or
its content in the release. If you want to create a fork, a modified version,
of this sample library you have to release and distribute it under a different name.
https://creativecommons.org/licenses/by-sa/3.0/
Official licensing statement: https://bandshed.net/pdf/AVL-Drumkits%20CC-BY-SA%20License.pdf

DrumLab Black Pearl Selection / DrumLab Red Zeppelin Selection
===========================================================
Web selections adapted by DrumLab from Glen MacArthur's official 2023 SFZ packs.
Selected eight drum articulations with all five original velocity layers.
Original WAV recordings converted to Ogg Vorbis; original sample rates,
channel layouts, lengths and tails retained. Open hi-hat uses HatSwish.
These adapted sample selections remain CC-BY-SA 3.0 with the above exception.
The code and all other project assets retain their respective licenses.
See manifest.json for source filenames, URLs and SHA-256 hashes.
'''
(OUT/'LICENSE.txt').write_text(license_text)
print('Prepared',len(manifest),'real recordings;',sum(p.stat().st_size for p in OUT.rglob('*.ogg')),'bytes')
