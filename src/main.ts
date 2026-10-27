import './style.css';
import { GameApp } from './app';
import { installAppExtras } from './appExtras';

installAppExtras(GameApp as unknown as { prototype: Record<string, unknown> });
const game = new GameApp();
(window as unknown as { __game: GameApp }).__game = game;
