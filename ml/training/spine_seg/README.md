# Omurga MR segmentasyonu (SPIDER)

Sagittal omurga MR kesitlerinde **omur**, **spinal kanal** ve **disk** bölgelerini bulan 2D U-Net (MONAI).
İnsan bel MR'ı (SPIDER) ile eğitilir; köpek verisi gelince onunla test edilecek. Issue: #99.

> Model tanı koymaz, yapıları bulur. İnsan verisiyle eğitildiği için veteriner görüntülerinde doğrulanmadan
> klinik doğruluk iddiası yapılmaz; checkpoint'ler her zaman `clinically_approved=false` yazılır.
> Veri ve model ağırlıkları git'e girmez.

## Veri seti

SPIDER - Lumbar spine segmentation in MR images ([Zenodo 10159290](https://zenodo.org/records/10159290),
CC BY 4.0). 218 hasta, 447 sagittal seri (196 T1, 210 T2, 41 T2 SPACE), toplam 3,8 GB.
Atıf: van der Graaf ve ark., *Sci Data* 11, 264 (2024), doi:10.1038/s41597-024-03090-w.

Maske değerleri 4 sınıfa indirilir (`labels.py`):

| SPIDER değeri | Anlamı | Sınıf |
|---|---|---|
| 0 | arka plan | 0 `background` |
| 1-25, 101-125 | omur (tam / kısmen görünen) | 1 `vertebra` |
| 100 | spinal kanal | 2 `spinal_canal` |
| 201-225 | disk | 3 `disc` |

İnsan omur seviye numaraları (L5 vb.) köpekte anlamsız olduğu için seviyeler birleştirilir.

Ayrım hasta bazındadır: SPIDER'ın resmi `validation` seti (39 hasta) **test** olarak ayrılır ve model seçiminde
hiç kullanılmaz; resmi `training` setinden (179 hasta) %15'i hasta bazında doğrulama setine ayrılır.

## Sunucuda kurulum

```bash
git clone https://github.com/alperen585858/vetmind-ai.git && cd vetmind-ai
python3 -m venv ~/venvs/spine && source ~/venvs/spine/bin/activate
# PyTorch'u sunucunun CUDA sürümüne göre kur (https://pytorch.org/get-started/locally/), örnek CUDA 12.8:
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install -r ml/training/spine_seg/requirements.txt
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

## 1. Veriyi indir

```bash
DATA=~/data/spider            # sunucudaki veri klasörü (repo dışında)
mkdir -p $DATA && cd $DATA
for f in images.zip masks.zip overview.csv; do
  wget -c "https://zenodo.org/records/10159290/files/$f?download=1" -O $f
done
md5sum images.zip masks.zip    # 7a9fa44aac0c72e2937bdef62cff88db / 49861ff25a0108b3b69d0ce808ae51dc
unzip -q images.zip && unzip -q masks.zip && cd -
```

## 2. Hazırla

```bash
python -m ml.training.spine_seg.prepare_spider --spider-dir ~/data/spider --out ~/data/spider_prepared
```

Her seri sagittal kesit yığınına çevrilir (üst satır = kraniyal, sol sütun = ventral), yoğunluk seri başına
%0,5-%99,5 aralığına göre 0-1'e ölçeklenir. Çıktı: `series/*.npy`, `splits.json`, `series_info.json`.
Hızlı deneme için `--limit 10`, sadece T2 için `--sequences t2`.

## 3. Eğit

```bash
python -m ml.training.spine_seg.train --data ~/data/spider_prepared --run-dir ml/runs/spine-seg
```

- Her epoch sonunda `last.pt` ve `log.csv` yazılır; doğrulama Dice'ı en iyi olan `best.pt` olarak saklanır.
- Bağlantı koparsa veya iş kesilirse aynı komutu `--resume` ile çalıştırınca kaldığı yerden devam eder.
- Varsayılanlar: 100 epoch, batch 16, 256x256, AdamW 3e-4, cosine, Dice + cross entropy, CUDA'da karışık hassasiyet.
- Ekran kartı belleği yetmezse `--batch-size 8`.
- Oturum kapanınca işin durmaması için `nohup ... > train.log 2>&1 &` veya `tmux` kullanın.

Sunucu SLURM kullanıyorsa örnek iş dosyası:

```bash
#!/bin/bash
#SBATCH --job-name=spine-seg
#SBATCH --gres=gpu:1
#SBATCH --cpus-per-task=8
#SBATCH --time=24:00:00
#SBATCH --output=spine-seg-%j.log
source ~/venvs/spine/bin/activate
cd ~/vetmind-ai
python -m ml.training.spine_seg.train --data ~/data/spider_prepared --run-dir ml/runs/spine-seg --resume --workers 8
```

## 4. Değerlendir

```bash
python -m ml.training.spine_seg.evaluate --checkpoint ml/runs/spine-seg/best.pt \
  --data ~/data/spider_prepared --split test --out ml/runs/spine-seg/test_results.json
```

Seri başına 3D Dice hesaplanır (tüm sagittal kesitler, orijinal çözünürlükte). `test_results.json` sınıf ve sekans
(T1 / T2 / T2 SPACE) bazında ortalama ve standart sapma içerir; `test_results.csv` seri başına sonuçlardır.
Bir sınıf hem tahminde hem gerçekte yoksa Dice ortalamaya katılmaz (yanıltıcı 1,0 yerine).

## Gerçek veri olmadan deneme

Kod, sahte (geometrik) bir SPIDER kopyasıyla CPU'da uçtan uca test edilir; indirme ve ekran kartı gerekmez:

```bash
PYTHONPATH=. python -m pytest ml/tests -q
```

Bu test sadece yazılımın çalıştığını gösterir, model kalitesi hakkında bir şey söylemez.

## Sonraki adımlar (ayrı issue)

- `best.pt`'yi backend'deki MRI entrypoint'ine bağlamak; maskeyi görüntüleyicide göstermek.
- Maskeden ölçüm çıkarmak (örnek: disk hizasında kanal daralması) ve bunları bulgu olarak rapora vermek.
- Köpek MR verisiyle test.
