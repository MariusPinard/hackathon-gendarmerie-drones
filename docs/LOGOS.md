# Logos transparents

Le détourage utilise le mode intégré du skill imagegen, avec fond transparent demandé et alpha conservé. Les sources restent dans `public/image/log_GN.webp` et `public/image/division-drone.png`.

Résultats intégrés : `public/image/gendarmerie-transparent.png` et `public/image/division-drone-transparent.png`. Les deux PNG sont RGBA et leurs coins sont transparents. L’accueil et l’en-tête les affichent sans plaque, bordure ni fond ajouté. Le contraste est adapté au thème par CSS ; la version des fichiers reste inchangée.

## Prompts utilisés

### Gendarmerie nationale

Use case: background-extraction. Edit target: the attached Gendarmerie nationale logo. Remove only its flat white background and return a real transparent RGBA PNG, also transparent between lettering, inside letters and between all strokes. Keep the existing exact dark blue curved emblem, all letters, proportions, layout and black handwritten signature unchanged. Text verbatim: "Gendarmerie", "nationale", "Une force humaine". Do not redraw, restyle, recolor, add or omit any stroke or letter. Clean antialiased alpha edges, no white halo, no shadows, no background, no checkerboard painted into the image. Preserve the entire emblem and all text with a small transparent margin.

### Division Drone

Use case: background-extraction. Edit target: the provided Division Drone logo artwork. Extract only the central drone with its circular radar rings/crosshair/blue nodes, the original two lines of lettering, and the small white flaming grenade emblem at the bottom. Remove the entire dark navy background and ALL topographic contour-line texture everywhere, including within the circular emblem and between strokes. Return real transparent RGBA PNG with clean antialiased edges. Preserve the original exact white and blue artwork, dimensions, relative positions, original typography and all details; do not redraw, reword, recolor or redesign. Text verbatim: "DIVISION DRONE", "PLANIFIER ET COORDONNER". Preserve the small bottom grenade. No added white background, no rectangular plaque, no opaque dark regions inside rings, no checkerboard painted into the image.
