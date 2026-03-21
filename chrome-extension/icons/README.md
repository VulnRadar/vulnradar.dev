/* Placeholder icon generator - creates PNG icons using canvas */
(function() {
  const sizes = [16, 32, 48, 96, 128];
  
  function createIcon(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Dark background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, size, size);
    
    // Cyan circle (VulnRadar primary color)
    ctx.fillStyle = '#06b6d4';
    const padding = size * 0.15;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, (size / 2) - padding, 0, Math.PI * 2);
    ctx.fill();
    
    // Shield icon (security symbol)
    const shieldSize = size * 0.5;
    const shieldX = (size - shieldSize) / 2;
    const shieldY = (size - shieldSize) / 2 + size * 0.05;
    
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(shieldX + shieldSize * 0.5, shieldY);
    ctx.lineTo(shieldX + shieldSize, shieldY + shieldSize * 0.4);
    ctx.lineTo(shieldX + shieldSize, shieldY + shieldSize * 0.6);
    ctx.bezierCurveTo(
      shieldX + shieldSize, shieldY + shieldSize,
      shieldX + shieldSize * 0.5, shieldY + shieldSize * 0.9,
      shieldX, shieldY + shieldSize * 0.6
    );
    ctx.lineTo(shieldX, shieldY + shieldSize * 0.4);
    ctx.closePath();
    ctx.fill();
    
    return canvas.toDataURL('image/png');
  }
  
  // Generate icons
  const icons = {};
  sizes.forEach(size => {
    icons[size] = createIcon(size);
    console.log(`Icon ${size}x${size} generated`);
  });
  
  console.log('Icon generation complete. Icons:', icons);
})();
