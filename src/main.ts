import Phaser from 'phaser';
import './style.css';
import { COLORS } from './config';
import { CourseScene } from './scene/CourseScene';
import { iceServers } from './net/relay';
import { setupScreens } from './ui/screens';

setupScreens();
// Get relay credentials ready before anyone opens or joins a room.
void iceServers();

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  backgroundColor: COLORS.bg,
  antialias: true,
  roundPixels: false,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [CourseScene],
});

// Phones scroll the page to keep a focused field above the keyboard and don't
// always scroll it back. Nothing here is meant to scroll, so once no field has
// focus, put the page back and refit the game to the screen.
document.addEventListener('focusout', () =>
  setTimeout(() => {
    if (document.activeElement instanceof HTMLInputElement) return;
    window.scrollTo(0, 0);
    game.scale.refresh();
  }, 100),
);
