import { expect, it } from "vitest";
import { networkKey, networkId } from "./ip.js";
it("groups alternate IPv6 spellings and rotating addresses within a /64", () => {
  expect(networkKey("2001:db8:abcd:12::1")).toBe(
    networkKey("2001:0DB8:abcd:0012:ffff:aaaa:bbbb:cccc"),
  );
  expect(networkKey("2001:db8:abcd:13::1")).not.toBe(
    networkKey("2001:db8:abcd:12::1"),
  );
  expect(networkKey("192.0.2.1")).toBe("192.0.2.1");
  expect(networkKey("attacker-value")).toBe("unknown");
});

it("uses a secret to derive network quota keys", () => {
  expect(networkId("2001:db8:abcd:12::1", "a")).toBe(
    networkId("2001:db8:abcd:12::2", "a"),
  );
  expect(networkId("192.0.2.1", "a")).not.toBe(networkId("192.0.2.1", "b"));
  expect(networkId("192.0.2.1", "a")).toMatch(/^[a-f0-9]{64}$/);
});
