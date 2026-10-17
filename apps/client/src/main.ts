import "./style.css";
import { Game } from "./game.ts";

const game = new Game(document.getElementById("game") as HTMLCanvasElement, document.getElementById("hud")!);
void game.load();
// Handy for poking at the sim from the devtools console.
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
