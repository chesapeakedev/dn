import { assertEquals, assertThrows } from "@std/assert";
import { exeDevApiUrl } from "./exeDevRunner.ts";

Deno.test("exe.dev endpoint preserves production default", () => {
  Deno.env.delete("EXE_DEV_API_URL");
  assertEquals(exeDevApiUrl(), "https://exe.dev/exec");
});

Deno.test("exe.dev endpoint allows an explicit contract twin", () => {
  Deno.env.set("EXE_DEV_API_URL", "http://127.0.0.1:4545/exec");
  Deno.env.set("EXE_DEV_ALLOW_INSECURE_HTTP", "1");
  try {
    assertEquals(exeDevApiUrl(), "http://127.0.0.1:4545/exec");
  } finally {
    Deno.env.delete("EXE_DEV_API_URL");
    Deno.env.delete("EXE_DEV_ALLOW_INSECURE_HTTP");
  }
});

Deno.test("exe.dev endpoint rejects insecure HTTP by default", () => {
  Deno.env.set("EXE_DEV_API_URL", "http://127.0.0.1:4545/exec");
  try {
    assertThrows(() => exeDevApiUrl(), Error, "must use HTTPS");
  } finally {
    Deno.env.delete("EXE_DEV_API_URL");
  }
});
