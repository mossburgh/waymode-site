import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export function networkKey(ip: string) {
  if (isIP(ip) !== 6) {
    return isIP(ip) === 4 ? ip : "unknown";
  }
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [left = "", right] = canonical.split("::");
  const head = left.split(":").filter(Boolean);
  const tail = right?.split(":").filter(Boolean) ?? [];
  const expanded =
    right === undefined
      ? head
      : [
          ...head,
          ...Array.from({ length: 8 - head.length - tail.length }, () => "0"),
          ...tail,
        ];
  return expanded.slice(0, 4).join(":") + "::/64";
}

export function networkId(ip: string, secret: string) {
  return createHmac("sha256", secret).update(networkKey(ip)).digest("hex");
}
