"""Build the vector map files the replay draws (projects/cs2-review/maps/<map>.json).

Reads each map's navigation mesh (the walkable floor the game's bots use) from your own
CS2 install, merges it into clean straight-edged floor shapes, and saves them as small JSON.
Also reads bomb-site / spawn positions and level splits (Nuke, Vertigo, Train) from the
map's overview file. No Valve artwork is copied: the map is redrawn from geometry.

    pip install vpk shapely awpy
    python tools/build_maps.py "C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive"
"""
import json, re, sys, tempfile
from pathlib import Path

import vpk
from awpy._awpy import NavMesh
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union

MAPS = ["de_mirage", "de_dust2", "de_inferno", "de_nuke", "de_ancient", "de_anubis",
        "de_overpass", "de_train", "de_vertigo", "de_cache"]
BAND = 40          # elevation step (game units) for the floor shading
CLOSE = 14         # how far to "close" small gaps between nav areas
OUT = Path(__file__).resolve().parent.parent / "maps"


def kv(text, key):
    m = re.search(r'"%s"\s+"([^"]+)"' % key, text)
    return float(m.group(1)) if m else None


def overview(text):
    pos_x, pos_y, scale = kv(text, "pos_x"), kv(text, "pos_y"), kv(text, "scale")
    def world(prefix):
        x, y = kv(text, prefix + "_x"), kv(text, prefix + "_y")
        if x is None: return None
        return [round(pos_x + x * 1024 * scale), round(pos_y - y * 1024 * scale)]
    split = None
    m = re.search(r'"lower".*?"AltitudeMax"\s+"([-\d.]+)"', text, re.S)
    if m: split = float(m.group(1))
    return {"sites": {"A": world("bombA"), "B": world("bombB")},
            "spawns": {"CT": world("CTSpawn"), "T": world("TSpawn")}, "split": split}


def rings(geom, tol):
    geom = geom.simplify(tol, preserve_topology=True)
    parts = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    out = []
    for g in parts:
        if g.is_empty or g.area < 2500: continue
        holes = [i for i in g.interiors if Polygon(i).area > 1600]
        out.append([[[round(x), round(y)] for x, y in r.coords[:-1]] for r in [g.exterior, *holes]])
    return out


def close(geoms, d=CLOSE, o=7):
    """Merge areas, fill hairline gaps (close), then shave off wall spikes (open)."""
    g = unary_union([g.buffer(d, join_style=2) for g in geoms]).buffer(-d, join_style=2)
    return g.buffer(-o, join_style=2).buffer(o, join_style=2)


def build(name, nav_path, ov):
    nav = NavMesh(Path(nav_path))
    areas = []
    for aid in nav.areas["area_id"].to_list():
        c = nav.area(aid)["corners"]
        p = Polygon([(x, y) for x, y, _ in c])
        if p.is_valid and p.area > 0:
            areas.append((p, sum(z for *_, z in c) / len(c)))
    split = ov["split"]
    level_defs = [("upper", lambda z: True)] if split is None else \
        [("upper", lambda z: z >= split), ("lower", lambda z: z < split)]
    levels = []
    for lname, keep in level_defs:
        mine = [(p, z) for p, z in areas if keep(z)]
        if not mine: continue
        zs = sorted(z for _, z in mine)
        z0, z1 = zs[int(len(zs) * 0.02)], zs[int(len(zs) * 0.98) - 1]
        bands = {}
        for p, z in mine:
            bands.setdefault(int((min(max(z, z0), z1) - z0) // BAND), []).append(p)
        lx = [x for p, _ in mine for x in p.exterior.xy[0]]
        ly = [y for p, _ in mine for y in p.exterior.xy[1]]
        levels.append({
            "name": lname, "zmin": round(z0), "zmax": round(z1),
            "bounds": [round(min(lx)), round(min(ly)), round(max(lx)), round(max(ly))],
            "outline": rings(close([p for p, _ in mine]), 3),
            "bands": [{"k": round(k * BAND / max(1, z1 - z0), 3), "shapes": rings(close(ps, 4, 3), 3)}
                      for k, ps in sorted(bands.items())],
        })
    xs = [x for p, _ in areas for x in p.exterior.xy[0]]
    ys = [y for p, _ in areas for y in p.exterior.xy[1]]
    return {"name": name, "bounds": [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))],
            "split": split, "sites": ov["sites"], "spawns": ov["spawns"], "levels": levels}


def main(game_dir):
    csgo = Path(game_dir) / "game" / "csgo"
    pak = vpk.open(str(csgo / "pak01_dir.vpk"))
    OUT.mkdir(exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    for name in MAPS:
        mv = csgo / "maps" / (name + ".vpk")
        if not mv.exists(): print("skip", name, "(not installed)"); continue
        mpak = vpk.open(str(mv))
        nav = tmp / (name + ".nav")
        nav.write_bytes(mpak["maps/%s.nav" % name].read())
        ov = overview(pak["resource/overviews/%s.txt" % name].read().decode("utf-8", "replace"))
        data = build(name, nav, ov)
        f = OUT / (name + ".json")
        f.write_text(json.dumps(data, separators=(",", ":")))
        print(name, f.stat().st_size // 1024, "KB", [l["name"] for l in data["levels"]])


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else
         "C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive")
