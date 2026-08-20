# Model credits

`player.gltf` / `player.bin`

Derived from **Universal Animation Library** by [Quaternius](https://quaternius.com/) —
distributed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain, no
attribution required; credited here anyway as good practice).

Free-version mirror used as the source: https://github.com/J-Ponzo/gltf-universal-animation-library

Only the material `baseColorFactor`/`roughnessFactor` values were edited (recolored from the
original bright orange/purple placeholder to an earthy leather/bronze tone) and the buffer file was
renamed from `AnimationLibrary_Godot_Standard.bin` to `player.bin` (with the `.gltf`'s buffer `uri`
updated to match). Geometry, skeleton, and all 46 animation clips are untouched.

The bundled mesh (named `Mannequin` in the source) is an untextured placeholder body meant for
testing animations, not a finished character — swap in a properly textured/clothed model sharing the
same skeleton (e.g. one of Quaternius's "Universal Base Characters") when one is available; the
animation clips referenced in `src/PlayerModel.tsx` will keep working unchanged as long as the new
model reuses this skeleton.
