import Phaser from 'phaser';
import './style.css';
import { COLORS } from './config';
import { CourseScene } from './scene/CourseScene';
import { setupScreens } from './ui/screens';

setupScreens();

new Phaser.Game({
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
