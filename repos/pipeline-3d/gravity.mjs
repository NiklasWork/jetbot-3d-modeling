#!/usr/bin/env node
// gravity.mjs — read COLMAP camera poses, print the rotation that stands the
// scene upright, as splat-transform's `-r ex,ey,ez` argument.
//
//   node gravity.mjs <run>/undistorted/sparse/images.bin
//
// COLMAP's world frame is anchored to the first registered camera, so a
// reconstruction lands at an arbitrary attitude. The SuperSplat viewer assumes
// +Y is up: it yaws the camera around world Y, clamps pitch against it and
// forces roll to zero. A scene that is not gravity-aligned therefore cannot be
// steered — turning rolls the room instead of panning it.
//
// The estimate comes from the cameras, not the splats: a hand-held camera is
// held without roll, so every camera's x-axis (its "right") is horizontal, and
// gravity is the one direction perpendicular to all of them — the smallest
// eigenvector of Σ r·rᵀ. Pitch does not disturb it, which a floor-plane fit
// would need to survive; the mean camera up only picks the sign.
//
// The angles are for the data frame. The viewer's own fixed 180° roll about Z
// then turns the scene's up into world +Y.

import { readFileSync } from 'node:fs';

const DEG = 180 / Math.PI;

const die = (msg) => { console.error(`gravity: ${msg}`); process.exit(1); };

// ── COLMAP images.bin ───────────────────────────────────────────────────────
// uint64 count, then per image: uint32 id · 4×f64 quaternion (w,x,y,z) ·
// 3×f64 translation · uint32 camera id · NUL-terminated name · uint64 point
// count · that many 24-byte 2D observations.
const readPoses = (path) => {
    let buf;
    try {
        buf = readFileSync(path);
    } catch (err) {
        die(`cannot read ${path} — ${err.code ?? err.message}`);
    }
    const n = Number(buf.readBigUInt64LE(0));
    if (!(n > 0) || n > 1e6) die(`${path} claims ${n} images — not a COLMAP images.bin`);
    let o = 8;
    const rights = [];
    const ups = [];
    for (let i = 0; i < n; i++) {
        o += 4;
        const qw = buf.readDoubleLE(o), qx = buf.readDoubleLE(o + 8),
              qy = buf.readDoubleLE(o + 16), qz = buf.readDoubleLE(o + 24);
        o += 32 + 24 + 4;
        while (buf[o] !== 0) o++;
        o++;
        o += 8 + Number(buf.readBigUInt64LE(o)) * 24;
        if (o > buf.length) die(`${path} ends inside image ${i + 1} of ${n}`);
        // world→camera rotation; its rows are the camera axes in world space
        rights.push([
            1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)
        ]);
        ups.push([
            -(2 * (qx * qy + qz * qw)), -(1 - 2 * (qx * qx + qz * qz)), -(2 * (qy * qz - qx * qw))
        ]);
    }
    return { rights, ups };
};

// ── linear algebra, 3×3 ─────────────────────────────────────────────────────
const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]
];
const matmul = (A, B) => A.map((row, i) =>
    [0, 1, 2].map((j) => row.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));

// Cyclic Jacobi — exact enough for a symmetric 3×3 and free of dependencies.
const eigenSym3 = (M) => {
    let a = M.map((r) => r.slice());
    let V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 24; sweep++) {
        let off = 0;
        for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) off += a[p][q] * a[p][q];
        if (off < 1e-24) break;
        for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
            if (Math.abs(a[p][q]) < 1e-30) continue;
            const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
            const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
            const c = 1 / Math.sqrt(t * t + 1), s = t * c;
            const R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
            R[p][p] = c; R[q][q] = c; R[p][q] = s; R[q][p] = -s;
            const Rt = [0, 1, 2].map((i) => [0, 1, 2].map((j) => R[j][i]));
            a = matmul(matmul(Rt, a), R);
            V = matmul(V, R);
        }
    }
    const pairs = [0, 1, 2].map((i) => ({ value: a[i][i], vector: [V[0][i], V[1][i], V[2][i]] }));
    return pairs.sort((x, y) => x.value - y.value);
};

// ── the rotation ────────────────────────────────────────────────────────────
// Smallest rotation carrying `u` onto `v`, as a matrix (Rodrigues).
const alignMatrix = (u, v) => {
    const axis = cross(u, v);
    const s = Math.hypot(...axis), c = dot(u, v);
    if (s < 1e-9) {
        return c > 0
            ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
            : [[-1, 0, 0], [0, -1, 0], [0, 0, 1]];  // 180°, any perpendicular axis
    }
    const [x, y, z] = axis.map((k) => k / s);
    const K = [[0, -z, y], [z, 0, -x], [-y, x, 0]];
    const K2 = matmul(K, K);
    return [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
        (i === j ? 1 : 0) + s * K[i][j] + (1 - c) * K2[i][j]));
};

// splat-transform applies `-r ex,ey,ez` as Rz(+ez)·Ry(−ey)·Rx(−ex) — measured
// against v3.3.3 on a three-splat file, single axes and a mixed angle.
const toSplatTransformEuler = (R) => {
    const b = -Math.asin(Math.max(-1, Math.min(1, R[2][0])));
    const a = Math.atan2(R[2][1], R[2][2]);
    const c = Math.atan2(R[1][0], R[0][0]);
    return [-a * DEG, -b * DEG, c * DEG];
};

const fromSplatTransformEuler = ([ex, ey, ez]) => {
    const [a, b, c] = [-ex / DEG, -ey / DEG, ez / DEG];
    const Rx = [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
    const Ry = [[Math.cos(b), 0, Math.sin(b)], [0, 1, 0], [-Math.sin(b), 0, Math.cos(b)]];
    const Rz = [[Math.cos(c), -Math.sin(c), 0], [Math.sin(c), Math.cos(c), 0], [0, 0, 1]];
    return matmul(matmul(Rz, Ry), Rx);
};

// ── main ────────────────────────────────────────────────────────────────────
const path = process.argv[2];
if (!path) die('usage: gravity.mjs <run>/undistorted/sparse/images.bin');

const { rights, ups } = readPoses(path);
if (rights.length < 8) die(`only ${rights.length} poses — too few to fit a horizon`);

const M = [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
    rights.reduce((s, r) => s + r[i] * r[j], 0)));
const [smallest, middle] = eigenSym3(M);
let up = norm(smallest.vector);

const meanUp = norm([0, 1, 2].map((i) => ups.reduce((s, u) => s + u[i], 0)));
if (dot(up, meanUp) < 0) up = up.map((c) => -c);

// The viewer's up is data-space −Y: it rolls the scene 180° about Z, which
// turns −Y into world +Y.
const R = alignMatrix(up, [0, -1, 0]);
const euler = toSplatTransformEuler(R);

const check = fromSplatTransformEuler(euler);
const landed = [0, 1, 2].map((i) => dot(check[i], up));
const residual = Math.hypot(landed[0], landed[1] + 1, landed[2]);
if (!(residual < 1e-6)) die(`euler decomposition is off by ${residual.toFixed(6)} — refusing to guess`);

const rms = Math.sqrt(rights.reduce((s, r) => s + dot(up, r) ** 2, 0) / rights.length);
const tilt = Math.acos(Math.max(-1, Math.min(1, -up[1]))) * DEG;
console.error(`gravity: ${rights.length} poses · up ${up.map((c) => c.toFixed(3)).join(',')} ` +
    `· tilt ${tilt.toFixed(1)}° · rms ${rms.toFixed(3)}`);
if (middle.value > 0 && smallest.value / middle.value > 0.5) {
    console.error('gravity: horizon is barely determined — cameras share too few orientations');
}

console.log(euler.map((a) => a.toFixed(3)).join(','));
