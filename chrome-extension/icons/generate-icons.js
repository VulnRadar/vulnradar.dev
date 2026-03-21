#!/usr/bin/env node
/**
 * Icon Generator for VulnRadar Chrome Extension
 * Generates proper PNG icons in all required sizes (16x16, 32x32, 48x48, 96x96, 128x128)
 * 
 * Usage: node generate-icons.js
 * Requires: npm install sharp
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// VulnRadar colors
const colors = {
  dark: '#0f172a',
  cyan: '#06b6d4',
};

const sizes = [16, 32, 48, 96, 128];

async function generateIcon(size) {
  // Create SVG for the icon
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <!-- Background -->
      <rect width="${size}" height="${size}" fill="${colors.dark}"/>
      
      <!-- Cyan circle -->
      <circle cx="${size/2}" cy="${size/2}" r="${(size/2) * 0.85}" fill="${colors.cyan}"/>
      
      <!-- Shield icon -->
      <g transform="translate(${size * 0.25}, ${size * 0.25})">
        <path d="M ${size * 0.25} 0 L ${size * 0.5} 0 L ${size * 0.5} ${size * 0.3} L ${size * 0.75} ${size * 0.35} L ${size * 0.75} ${size * 0.6} Q ${size * 0.75} ${size * 0.85} ${size * 0.25} ${size * 0.75} Q ${size * -0.25} ${size * 0.85} ${size * -0.25} ${size * 0.6} L ${size * -0.25} ${size * 0.35} L 0 ${size * 0.3} Z" 
              fill="${colors.dark}" stroke="${colors.dark}" stroke-width="1"/>
      </g>
    </svg>
  `;
  
  try {
    await sharp(Buffer.from(svg))
      .png()
      .toFile(`${size}x${size}.png`);
    console.log(`✓ Generated ${size}x${size}.png`);
  } catch (err) {
    console.error(`✗ Failed to generate ${size}x${size}.png:`, err.message);
  }
}

async function main() {
  const iconsDir = __dirname;
  process.chdir(iconsDir);
  
  console.log('Generating VulnRadar Chrome Extension icons...\n');
  
  for (const size of sizes) {
    await generateIcon(size);
  }
  
  console.log('\n✓ Icon generation complete!');
  console.log('Generated files: 16x16.png, 32x32.png, 48x48.png, 96x96.png, 128x128.png');
}

main().catch(console.error);
