import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { FRAME } from "@/lib/media";

const fontsDir = path.join(process.cwd(), "assets", "fonts");
let fonts: Promise<{ medium: Buffer; bold: Buffer }> | null = null;
function loadFonts() {
  fonts ??= Promise.all([
    readFile(path.join(fontsDir, "Inter-Medium.ttf")),
    readFile(path.join(fontsDir, "Inter-ExtraBold.ttf")),
  ]).then(([medium, bold]) => ({ medium, bold }));
  return fonts;
}

function toDataUrl(bytes: Uint8Array, mime = "image/jpeg") {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

export type FrameInput = {
  cover: Uint8Array;
  position: string;
  trackTitle: string;
  trackArtists: string;
  releaseTitle: string;
  index: number; // 1-based
  total: number;
};

/** One carousel slide: square cover on top, track info band below (1080x1350 PNG). */
export async function renderFrame(input: FrameInput): Promise<Uint8Array> {
  const { medium, bold } = await loadFonts();
  const band = FRAME.height - FRAME.width;
  const titleSize = input.trackTitle.length > 34 ? 46 : 58;

  const res = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0b0b0b" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={toDataUrl(input.cover)}
          width={FRAME.width}
          height={FRAME.width}
          style={{ width: FRAME.width, height: FRAME.width, objectFit: "cover" }}
          alt=""
        />
        <div
          style={{
            height: band,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 64px",
            color: "#f5f1e8",
            fontFamily: "Inter",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 14 }}>
            {input.position ? (
              <div
                style={{
                  display: "flex",
                  fontSize: 30,
                  fontWeight: 800,
                  color: "#0b0b0b",
                  background: "#f2c14e",
                  borderRadius: 10,
                  padding: "4px 14px",
                }}
              >
                {input.position}
              </div>
            ) : null}
            <div style={{ display: "flex", fontSize: 28, color: "#9a958a", fontWeight: 500 }}>
              {`${input.index}/${input.total}`}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: titleSize,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: -1,
              maxHeight: titleSize * 2.2,
              overflow: "hidden",
            }}
          >
            {input.trackTitle}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              fontWeight: 500,
              color: "#b8b2a4",
              marginTop: 12,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {[input.trackArtists, input.releaseTitle].filter(Boolean).join(" — ")}
          </div>
        </div>
      </div>
    ),
    {
      width: FRAME.width,
      height: FRAME.height,
      fonts: [
        { name: "Inter", data: medium, weight: 500, style: "normal" },
        { name: "Inter", data: bold, weight: 800, style: "normal" },
      ],
    },
  );
  return new Uint8Array(await res.arrayBuffer());
}
