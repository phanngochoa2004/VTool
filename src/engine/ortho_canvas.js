/**
 * High-performance 2D Orthographic Canvas Renderer for 3D Bounding Boxes & Point Clouds.
 * Follows CVAT 3D Canvas conventions:
 * 1. Top View: Footprint viewed from above (Length horizontal, Width vertical).
 * 2. Side View: Side profile (Length horizontal, Height vertical, ground at bottom).
 * 3. Front View: Front/Rear profile (Width horizontal, Height vertical, ground at bottom).
 * Sized compactly with clean, unobtrusive CVAT-style heading cues (green rotation helper dot).
 */

// 32-level precomputed depth color palette to eliminate string allocation on every frame
const PALETTE_SIZE = 32;
const DEPTH_PALETTE = new Array(PALETTE_SIZE);
for (let i = 0; i < PALETTE_SIZE; i++) {
    const t = i / (PALETTE_SIZE - 1);
    const r = Math.round(40 + 215 * t);
    const g = Math.round(200 + 55 * (1 - t));
    const b = Math.round(255 * (1 - t));
    DEPTH_PALETTE[i] = `rgb(${r},${g},${b})`;
}

export class OrthoCanvasRenderer {
    /**
     * Compute projection metrics, scale, and layout coordinates for rendering & hit testing
     * @param {HTMLCanvasElement} canvas
     * @param {Object} box
     * @param {'top'|'side'|'front'} viewType
     * @param {Object} options
     */
    static getMetrics(canvas, box, viewType, options = {}) {
        const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        const width = canvas.clientWidth || canvas.width || 200;
        const height = canvas.clientHeight || canvas.height || 120;

        const { sx = 2, sy = 4, sz = 1.5 } = box || {};
        const zoom = options.zoom || 1.0;

        // Authentic CVAT projection conventions:
        // Top: Local X horizontal (sx), Local Y vertical (sy). Forward (+Y) points UP. Lateral (+X) points RIGHT.
        // Front: Looks from Red arrow (+X) towards -X. Green arrow (+Y) is on the RIGHT. Horizontal is sy, Vertical is sz.
        // Side: Looks from Green arrow (+Y) towards -Y. Red arrow (+X) is on the LEFT. Horizontal is sx, Vertical is sz.
        let dimH = 2;
        let dimV = 4;

        if (viewType === 'top') {
            dimH = sx;
            dimV = sy;
        } else if (viewType === 'front') {
            dimH = sy;
            dimV = sz;
        } else if (viewType === 'side') {
            dimH = sx;
            dimV = sz;
        }

        // Reference box for stable metric scale (pixels per meter).
        // Prevents box pixels from cancelling out dimensions, ensuring box expands/contracts in realtime.
        const refBox = options.referenceBox || box || {};
        const refSx = typeof refBox.sx === 'number' ? refBox.sx : sx;
        const refSy = typeof refBox.sy === 'number' ? refBox.sy : sy;
        const refSz = typeof refBox.sz === 'number' ? refBox.sz : sz;

        let refDimH = dimH;
        let refDimV = dimV;
        if (viewType === 'top') {
            refDimH = refSx;
            refDimV = refSy;
        } else if (viewType === 'front') {
            refDimH = refSy;
            refDimV = refSz;
        } else if (viewType === 'side') {
            refDimH = refSx;
            refDimV = refSz;
        }

        const marginFactor = options.marginFactor || 1.35;
        const padding = 14;
        const availW = Math.max(10, width - padding * 2);
        const availH = Math.max(10, height - padding * 2);
        const maxExtentH = Math.max(0.2, refDimH) * marginFactor;
        const maxExtentV = Math.max(0.2, refDimV) * marginFactor;

        const scale = (typeof options.scale === 'number' && options.scale > 0)
            ? options.scale
            : Math.min(availW / maxExtentH, availH / maxExtentV) * zoom;
        const centerX = width / 2;
        const centerY = height / 2;

        const boxPxW = dimH * scale;
        const boxPxH = dimV * scale;
        const boxLeft = centerX - boxPxW / 2;
        const boxTop = centerY - boxPxH / 2;
        const boxRight = boxLeft + boxPxW;
        const boxBottom = boxTop + boxPxH;

        // 4 Corner coordinates (Top-Left, Top-Right, Bottom-Left, Bottom-Right)
        const corners = {
            tl: { x: boxLeft, y: boxTop },
            tr: { x: boxRight, y: boxTop },
            bl: { x: boxLeft, y: boxBottom },
            br: { x: boxRight, y: boxBottom }
        };

        // Heading helper dot in Top view (placed on the forward +Y stem)
        const rotDotX = centerX;
        const rotDotY = boxTop - 20;

        return {
            dpr,
            width,
            height,
            sx,
            sy,
            sz,
            dimH,
            dimV,
            scale,
            centerX,
            centerY,
            boxPxW,
            boxPxH,
            boxLeft,
            boxTop,
            boxRight,
            boxBottom,
            corners,
            rotDotX,
            rotDotY,
            dotX: rotDotX,
            dotY: rotDotY
        };
    }

    /**
     * Render an orthogonal projection on a canvas
     * @param {HTMLCanvasElement} canvas
     * @param {Float32Array} localPoints - [lx, ly, lz, intensity, ...]
     * @param {Object} box - { x, y, z, rx, ry, rz, sx, sy, sz }
     * @param {'top'|'side'|'front'} viewType
     * @param {Object} options - display preferences & interaction state
     */
    static render(canvas, localPoints, box, viewType, options = {}) {
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const metrics = this.getMetrics(canvas, box, viewType, options);
        let {
            dpr, width, height, sx, sy, sz,
            dimH, dimV, scale, centerX, centerY,
            boxPxW, boxPxH, boxLeft, boxTop, boxRight, boxBottom,
            corners, rotDotX, rotDotY
        } = metrics;

        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
        }

        ctx.save();
        ctx.scale(dpr, dpr);

        // Interaction inspection
        const interaction = options.interaction || {};
        const isInteractingThisView = interaction.activeAction && interaction.viewType === viewType;
        const isHoveringThisView = interaction.hoverViewType === viewType;
        const isHoverRotation = (isHoveringThisView && interaction.hoverTarget === 'rotate') ||
                                (isInteractingThisView && interaction.activeAction === 'rotate');
        const isActivelyRotating = isInteractingThisView && interaction.activeAction === 'rotate';
        const isActivelyTranslating = isInteractingThisView && interaction.activeAction === 'translate';
        const activeResizeAction = isInteractingThisView && interaction.activeAction?.startsWith('resize')
            ? interaction.activeAction : null;

        // If this view is actively undergoing 4-corner resize, lock visual box directly to the mouse-driven bounds
        if (isInteractingThisView && interaction.activeAction === 'resize-corner' && interaction.resizeBoxPx) {
            const rbp = interaction.resizeBoxPx;
            boxLeft = rbp.left;
            boxTop = rbp.top;
            boxRight = rbp.right;
            boxBottom = rbp.bottom;
            boxPxW = rbp.width;
            boxPxH = rbp.height;
            corners = {
                tl: { x: boxLeft, y: boxTop },
                tr: { x: boxRight, y: boxTop },
                bl: { x: boxLeft, y: boxBottom },
                br: { x: boxRight, y: boxBottom }
            };
            rotDotX = boxLeft + boxPxW / 2;
            rotDotY = boxTop - 20;
        }

        // 1 & 2 & 3. Background, Grid, and Point Cloud Points
        let renderedPointsCount = 0;
        const isDraggingThisCard = isInteractingThisView && interaction.activeAction;

        if (isDraggingThisCard && canvas.__qaqc_bg_cache) {
            // High-speed 120+ FPS blit during dragging (0.02ms, 0 allocations, 0 INP lag)
            ctx.drawImage(canvas.__qaqc_bg_cache, 0, 0);
            renderedPointsCount = canvas.__qaqc_bg_pts_count || 0;
        } else {
            // Full render: Background
            ctx.fillStyle = '#141416';
            ctx.fillRect(0, 0, width, height);

            // Subtle CVAT-style grid
            this.drawSubtleGrid(ctx, width, height);

            // Center crosshair lines
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(centerX, 0);
            ctx.lineTo(centerX, height);
            ctx.moveTo(0, centerY);
            ctx.lineTo(width, centerY);
            ctx.stroke();
            ctx.setLineDash([]);

            const pointSize = typeof options.pointSize === 'number' ? options.pointSize : 1.0;

            if (localPoints && localPoints.length > 0) {
                renderedPointsCount = Math.floor(localPoints.length / 4);

                // Collect points into 32 pre-quantized depth buckets to eliminate per-point fill() overhead
                const buckets = new Array(PALETTE_SIZE);
                for (let b = 0; b < PALETTE_SIZE; b++) buckets[b] = [];

                for (let i = 0; i < localPoints.length; i += 4) {
                    const lx = localPoints[i];
                    const ly = localPoints[i + 1];
                    const lz = localPoints[i + 2];

                    let px = 0, py = 0, depth = 0;

                    if (viewType === 'top') {
                        px = centerX + lx * scale;
                        py = centerY - ly * scale;
                        depth = (lz + sz / 2) / Math.max(0.01, sz);
                    } else if (viewType === 'front') {
                        px = centerX + ly * scale;
                        py = centerY - lz * scale;
                        depth = (sx / 2 - lx) / Math.max(0.01, sx);
                    } else if (viewType === 'side') {
                        px = centerX - lx * scale;
                        py = centerY - lz * scale;
                        depth = (sy / 2 - ly) / Math.max(0.01, sy);
                    }

                    if (px < 0 || px > width || py < 0 || py > height) continue;

                    const bin = Math.min(PALETTE_SIZE - 1, Math.max(0, (depth * PALETTE_SIZE) | 0));
                    buckets[bin].push(px, py);
                }

                // Batch draw each bucket in a single path (max 32 draw calls instead of 20,000)
                const ptSize = Math.max(1.0, pointSize);
                const half = ptSize / 2;
                for (let b = 0; b < PALETTE_SIZE; b++) {
                    const pts = buckets[b];
                    const len = pts.length;
                    if (len === 0) continue;
                    ctx.fillStyle = DEPTH_PALETTE[b];
                    ctx.beginPath();
                    for (let j = 0; j < len; j += 2) {
                        ctx.rect(pts[j] - half, pts[j + 1] - half, ptSize, ptSize);
                    }
                    ctx.fill();
                }
            }

            // Snapshot background layer for instant 120 FPS dragging
            if (typeof document !== 'undefined') {
                try {
                    if (!canvas.__qaqc_bg_cache) {
                        canvas.__qaqc_bg_cache = document.createElement('canvas');
                    }
                    const bg = canvas.__qaqc_bg_cache;
                    if (bg.width !== width || bg.height !== height) {
                        bg.width = width;
                        bg.height = height;
                    }
                    const bgCtx = bg.getContext('2d');
                    if (bgCtx) {
                        bgCtx.clearRect(0, 0, width, height);
                        bgCtx.drawImage(canvas, 0, 0, width, height);
                    }
                    canvas.__qaqc_bg_pts_count = renderedPointsCount;
                } catch (_) {}
            }
        }

        const isOutside = !!options.outside;

        // 4. Render Bounding Box Fill & Border
        if (isOutside) {
            // Outside Box Styling:
            // Box position remains fully visible, styled with a dashed red border,
            // subtle red tint, and an OUTSIDE indicator watermark.
            ctx.fillStyle = isActivelyTranslating ? 'rgba(255, 69, 58, 0.18)' : 'rgba(255, 69, 58, 0.08)';
            ctx.fillRect(boxLeft, boxTop, boxPxW, boxPxH);

            ctx.save();
            ctx.strokeStyle = isActivelyTranslating ? '#FF453A' : 'rgba(255, 69, 58, 0.85)';
            ctx.lineWidth = isActivelyTranslating ? 2.0 : 1.6;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(boxLeft, boxTop, boxPxW, boxPxH);
            ctx.restore();

            // Centered OUTSIDE watermark badge inside the box
            ctx.save();
            ctx.font = '700 10.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", monospace, sans-serif';
            ctx.fillStyle = 'rgba(255, 69, 58, 0.7)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('OUTSIDE', centerX, centerY);
            ctx.restore();
        } else {
            // Normal Inside Box Styling
            ctx.fillStyle = isActivelyTranslating ? 'rgba(10, 132, 255, 0.16)' : 'rgba(24, 75, 140, 0.16)';
            ctx.fillRect(boxLeft, boxTop, boxPxW, boxPxH);

            ctx.strokeStyle = isActivelyTranslating ? '#0A84FF' : '#FFFFFF';
            ctx.lineWidth = isActivelyTranslating ? 2.0 : 1.5;
            ctx.strokeRect(boxLeft, boxTop, boxPxW, boxPxH);
        }

        // Ground reference line for Side and Front views
        if (viewType === 'side' || viewType === 'front') {
            const groundY = boxBottom;
            ctx.strokeStyle = isOutside ? 'rgba(255, 69, 58, 0.35)' : 'rgba(255, 255, 255, 0.25)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(boxLeft - 10, groundY);
            ctx.lineTo(boxRight + 10, groundY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 5. CVAT-style Heading & Rotation Helper
        if (isOutside) {
            ctx.save();
            ctx.globalAlpha = 0.55;
        }
        if (viewType === 'top') {
            this.drawCVATHeadingHelper(
                ctx,
                centerX,
                centerY,
                boxLeft,
                boxTop,
                boxPxW,
                boxPxH,
                isHoverRotation,
                isActivelyRotating
            );
        } else if (viewType === 'front') {
            // Front view looks from red arrow (+X). Green arrow (+Y) is on the right.
            ctx.strokeStyle = '#30D158';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(boxRight, boxTop);
            ctx.lineTo(boxRight, boxBottom);
            ctx.stroke();
            this.drawArrow(ctx, boxRight, centerY, boxRight + 18, centerY, '#30D158', 6, 1.8);
        } else if (viewType === 'side') {
            // Side view looks from green arrow (+Y). Red arrow (+X) is on the left.
            ctx.strokeStyle = '#FF3B30';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(boxLeft, boxTop);
            ctx.lineTo(boxLeft, boxBottom);
            ctx.stroke();
            this.drawArrow(ctx, boxLeft, centerY, boxLeft - 18, centerY, '#FF3B30', 6, 1.8);
        }
        if (isOutside) {
            ctx.restore();
        }

        // 6. CVAT 4 Red Corner Handles (All views)
        if (isOutside) {
            ctx.save();
            ctx.globalAlpha = 0.5;
            this.drawCornerHandles(ctx, corners, interaction);
            ctx.restore();
        } else {
            this.drawCornerHandles(ctx, corners, interaction);
        }

        // 7. Interactive HUD Badges
        if (isActivelyRotating) {
            const rz = box?.rz ?? 0;
            const deg = ((rz * 180 / Math.PI) % 360).toFixed(1);
            this.drawBadge(ctx, rotDotX, rotDotY, `⟳ Yaw: ${deg}°`, '#30D158');
        } else if (isActivelyTranslating) {
            const { x = 0, y = 0, z = 0 } = box || {};
            const posText = viewType === 'top'
                ? `X: ${x.toFixed(2)}m  Y: ${y.toFixed(2)}m`
                : `Z: ${z.toFixed(2)}m`;
            this.drawBadge(ctx, centerX, boxTop, posText, '#0A84FF');
        } else if (activeResizeAction) {
            const dimText = `${(box.sx || sx).toFixed(2)} × ${(box.sy || sy).toFixed(2)} × ${(box.sz || sz).toFixed(2)}m`;
            this.drawBadge(ctx, centerX, boxTop, dimText, '#FF3B30');
        }

        // 8. Dimension Caption (Bottom Left)
        ctx.font = '500 9.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", monospace, sans-serif';
        let dimLabel = `${dimH.toFixed(2)}m × ${dimV.toFixed(2)}m`;
        if (viewType === 'top') {
            dimLabel = `W:${sx.toFixed(2)}  L:${sy.toFixed(2)}m`;
        } else if (viewType === 'front') {
            dimLabel = `L:${sy.toFixed(2)}  H:${sz.toFixed(2)}m`;
        } else if (viewType === 'side') {
            dimLabel = `W:${sx.toFixed(2)}  H:${sz.toFixed(2)}m`;
        }
        if (isOutside) {
            ctx.fillStyle = 'rgba(255, 69, 58, 0.9)';
            ctx.fillText(`${dimLabel} • [OUTSIDE]`, 6, height - 5);
        } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.fillText(dimLabel, 6, height - 5);
        }

        // Points Count (Bottom Right)
        const ptsText = renderedPointsCount > 0 ? `${renderedPointsCount} pts` : '0 pts';
        ctx.fillStyle = renderedPointsCount > 0 ? 'rgba(48, 209, 88, 0.85)' : 'rgba(255, 159, 10, 0.7)';
        const ptsMetrics = ctx.measureText(ptsText);
        ctx.fillText(ptsText, width - ptsMetrics.width - 6, height - 5);

        ctx.restore();
    }

    /**
     * Draw subtle grid dots or lines matching CVAT dark mode
     */
    static drawSubtleGrid(ctx, w, h) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.lineWidth = 1;
        const gridSize = 20;
        ctx.beginPath();
        for (let x = 0; x < w; x += gridSize) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
        }
        for (let y = 0; y < h; y += gridSize) {
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
        }
        ctx.stroke();
    }

    /**
     * Draw directional 2D arrow helper
     */
    static drawArrow(ctx, fromX, fromY, toX, toY, color, headLen = 8, lineWidth = 1.8) {
        const angle = Math.atan2(toY - fromY, toX - fromX);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lineWidth;

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(
            toX - headLen * Math.cos(angle - Math.PI / 6),
            toY - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
            toX - headLen * Math.cos(angle + Math.PI / 6),
            toY - headLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Draw CVAT-style Orientation & Rotation Helper in Top view
     * Includes:
     * - Forward Green Arrow (+Y heading) protruding from front edge with green circle rotation helper dot
     * - Lateral Red Arrow (+X) protruding from right edge
     * - Center Pivot Dot (Blue)
     * - Circular guide orbit when rotating
     */
    static drawCVATHeadingHelper(ctx, cx, cy, boxL, boxT, boxW, boxH, isHovered = false, isInteracting = false) {
        const boxR = boxL + boxW;
        const boxB = boxT + boxH;

        const rotDotX = cx;
        const rotDotY = boxT - 20;
        const arrowTipY = boxT - 36;
        const latTipX = boxR + 28;

        // Circular guide orbit and radial ray when rotating
        if (isInteracting) {
            const rotRadius = Math.hypot(rotDotX - cx, rotDotY - cy);
            ctx.strokeStyle = 'rgba(48, 209, 88, 0.35)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(cx, cy, rotRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.strokeStyle = '#30D158';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(rotDotX, rotDotY);
            ctx.stroke();
        }

        // Front edge highlight (green line along the forward top edge)
        ctx.strokeStyle = '#30D158';
        ctx.lineWidth = isHovered || isInteracting ? 3.0 : 2.0;
        ctx.beginPath();
        ctx.moveTo(boxL, boxT);
        ctx.lineTo(boxR, boxT);
        ctx.stroke();

        // Lateral Arrow (Red, +X)
        this.drawArrow(ctx, boxR, cy, latTipX, cy, '#FF3B30', 7, 1.8);

        // Forward Heading Arrow (Green, +Y)
        this.drawArrow(ctx, cx, boxT, cx, arrowTipY, '#30D158', 8, 2.0);

        // Rotation helper halo ring if hovered or interacting
        if (isHovered || isInteracting) {
            ctx.strokeStyle = 'rgba(48, 209, 88, 0.45)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(rotDotX, rotDotY, 9, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Rotation Helper Green Dot
        const dotRadius = isHovered || isInteracting ? 6.5 : 4.5;
        ctx.fillStyle = '#30D158';
        ctx.beginPath();
        ctx.arc(rotDotX, rotDotY, dotRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Center Pivot Dot (Blue)
        ctx.fillStyle = '#0A84FF';
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 0.8;
        ctx.stroke();
    }

    /**
     * Draw CVAT 4 Red Corner Handles for 4-corner resizing
     * Highlights active dragging corner and renders anchor indicator on fixed opposite corner
     */
    static drawCornerHandles(ctx, corners, interaction = {}) {
        if (!corners) return;

        const { activeCornerKey, oppositeCornerKey, hoverTarget } = interaction;

        for (const [key, pt] of Object.entries(corners)) {
            const isHovered = hoverTarget === `corner-${key}`;
            const isActive = activeCornerKey === key;
            const isOppositeAnchor = oppositeCornerKey === key;

            // If this is the opposite anchor during resize, draw cyan anchor indicator
            if (isOppositeAnchor) {
                ctx.save();
                ctx.strokeStyle = '#0A84FF';
                ctx.lineWidth = 2;
                ctx.fillStyle = 'rgba(10, 132, 255, 0.35)';
                const sz = 12;
                ctx.strokeRect(pt.x - sz / 2, pt.y - sz / 2, sz, sz);
                ctx.fillRect(pt.x - sz / 2, pt.y - sz / 2, sz, sz);
                ctx.restore();
            }

            // Glow halo ring on hover or active
            if (isHovered || isActive) {
                ctx.strokeStyle = 'rgba(255, 59, 48, 0.45)';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Red corner circle
            const radius = (isHovered || isActive) ? 6.5 : 4.5;
            ctx.fillStyle = '#FF3B30';
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
            ctx.fill();

            // Outline
            ctx.strokeStyle = (isHovered || isActive) ? '#FFFFFF' : '#000000';
            ctx.lineWidth = (isHovered || isActive) ? 1.5 : 1.2;
            ctx.stroke();
        }
    }

    /**
     * Draw interactive HUD badge overlay on canvas
     */
    static drawBadge(ctx, x, y, text, borderColor = '#30D158') {
        ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", monospace, sans-serif';
        const textW = ctx.measureText(text).width;
        const padX = 7;
        const badgeW = textW + padX * 2;
        const badgeH = 18;
        const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        const bx = Math.max(5, Math.min(ctx.canvas.width / dpr - badgeW - 5, x - badgeW / 2));
        const by = Math.max(5, y - badgeH - 6);

        ctx.fillStyle = 'rgba(20, 20, 24, 0.92)';
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(bx, by, badgeW, badgeH, 4);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.fillRect(bx, by, badgeW, badgeH);
            ctx.strokeRect(bx, by, badgeW, badgeH);
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(text, bx + padX, by + 13);
    }

    static hexToRgba(hex, alpha) {
        let c = hex.replace('#', '');
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        const num = parseInt(c, 16);
        return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
    }
}
