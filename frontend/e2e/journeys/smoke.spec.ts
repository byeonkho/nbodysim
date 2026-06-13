import { journey } from "../lib/kit";

journey("app boots and the canvas mounts", async (j) => {
  await j.goto("/");
  await j.waitForCanvas();
  await j.screenshot("loaded");
});
