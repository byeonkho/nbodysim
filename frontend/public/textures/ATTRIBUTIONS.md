# Texture attributions

Source and license for each body texture in this directory. Required-attribution textures appear here; public-domain textures are listed for traceability.

## Major planets, Sun, Moon

The major-planet textures (`mercury_texture.jpg`, `venus_texture.jpg`, `earth_texture.jpg`, `mars_texture.jpg`, `jupiter_texture.jpg`, `saturn_texture.jpg`, `uranus_texture.jpg`, `neptune_texture.jpg`, `moon_texture.jpg`, `sun_texture.jpg`) and `fallback.jpg` are from the project's original setup and predate this attributions file. Provenance was not recorded at the time; if you re-deploy this project commercially, audit these assets before doing so.

## Minor bodies

| File | Body | Source | License | Notes |
|------|------|--------|---------|-------|
| `pluto.jpg` | Pluto | Steve Albers planetary maps, `stevealbers.net/albers/sos/pluto/pluto_rgb_cyl_8k.png` | Personal / non-commercial use | Underlying imagery: NASA New Horizons (public domain). Albers' processed mosaic carries the personal-use restriction. |
| `ceres.jpg` | Ceres | Steve Albers planetary maps, `stevealbers.net/albers/sos/asteroids/ceres_rgb_cyl.png` | Personal / non-commercial use | Underlying imagery: NASA Dawn (public domain). |
| `vesta.jpg` | Vesta | Steve Albers planetary maps, `stevealbers.net/albers/sos/asteroids/vesta.png` | Personal / non-commercial use | Underlying imagery: NASA Dawn HAMO (public domain). |
| `eros.jpg` | Eros | NASA PDS Small Bodies Node, Stooke Maps archive | Public domain | NEAR Shoemaker mission. |
| `bennu.jpg` | Bennu | NASA OSIRIS-REx mission, `asteroidmission.org/wp-content/uploads/2020/03/Bennu_Global_Mosaic.png` | Public domain | OSIRIS-REx global mosaic. |
| `ryugu.jpg` | Ryugu | JAXA DARTS archive, `data.darts.isas.jaxa.jp/pub/hayabusa2/products/01_GlobalMap1/hyb2_onc_Global_01_l3dm_v06.jpg` | Free for non-commercial use with attribution | Hayabusa2 mission. Credit: JAXA, University of Tokyo, Kochi University, Rikkyo University, Nagoya University, Chiba Institute of Technology, Meiji University, University of Aizu, AIST. |
| (fallback) | Pallas, Hygiea, Apophis | n/a | n/a | No published surface mosaics exist. These three bodies render the fallback texture until mission data becomes available (Apophis: post-2029 close-approach flyby). |

All minor-body textures were downsampled to 2048×1024 JPG at quality 85 for repository size; originals remain at their sources.

## Moons

All public-domain, from NASA/USGS mission mosaics (no required attribution; sources listed for traceability). Downsampled to 2048×1024 JPG at quality 85.

| File | Body | Source | License | Notes |
|------|------|--------|---------|-------|
| `phobos.jpg` | Phobos | NASA/USGS Astrogeology — Phobos Viking Global Mosaic, `planetarymaps.usgs.gov/mosaic/Phobos_Viking_Mosaic_40ppd_DLRcontrol.tif` | Public domain | Viking Orbiter imagery, DLR control. |
| (fallback) | Deimos | n/a | n/a | No public-domain global mosaic exists; available Commons maps are CC-BY-SA artist reconstructions. Rides the fallback texture. |
| `io.jpg` | Io | NASA/USGS Astrogeology — Io Galileo SSI/Voyager Color Merge Global Mosaic 1km | Public domain | Color. |
| `europa.jpg` | Europa | NASA/USGS Astrogeology — Europa Voyager/Galileo SSI Global Mosaic 500m | Public domain | Grayscale. |
| `ganymede.jpg` | Ganymede | NASA/USGS Astrogeology — Ganymede Voyager/Galileo SSI Color Global Mosaic 1.4km | Public domain | Color. |
| `callisto.jpg` | Callisto | NASA/USGS Astrogeology — Callisto Voyager/Galileo SSI Global Mosaic 1km | Public domain | Grayscale. |
| (fallback) | Nereid | n/a | n/a | Never resolved by any spacecraft; no surface mosaic exists. |

## License caveats

- **Steve Albers' textures** (Pluto, Ceres, Vesta) are licensed for personal / non-commercial use only. This project is a personal portfolio piece and qualifies. Any commercial use would require either contacting Albers directly or replacing these assets with mission-derived public-domain mosaics (e.g. processing NASA Dawn / New Horizons source data directly).
- **JAXA Ryugu mosaic** requires attribution. The full attribution string is included in the Ryugu row above.
