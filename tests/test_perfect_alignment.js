const fs = require('fs');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

async function testPerfectAlignment() {
  const imgBuf = fs.readFileSync('example2_original_page1.png');
  const img = await loadImage(imgBuf);
  const w = img.width;
  const h = img.height;

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  // Exact fields with pixel-precise bounds
  const fields = [
    { label: 'Ref No', val: '27 A', b: { x: 0.100, y: 0.1936, width: 0.092, height: 0.0172 } },
    { label: 'Form Date', val: '01.17.24', b: { x: 0.275, y: 0.1936, width: 0.165, height: 0.0172 } },
    { label: 'Project Name', val: 'LIFE ONE', b: { x: 0.550, y: 0.1936, width: 0.335, height: 0.0172 } },
    { label: 'Building Address', val: 'HQ BELFAST', b: { x: 0.188, y: 0.2108, width: 0.700, height: 0.0172 } },

    { label: 'Name of the person involved', val: 'JOHN', b: { x: 0.278, y: 0.2464, width: 0.230, height: 0.0179 } },
    { label: 'D.O.B', val: '21-07-17', b: { x: 0.560, y: 0.2464, width: 0.125, height: 0.0179 } },
    { label: 'Age', val: '2 1/2', b: { x: 0.685, y: 0.2464, width: 0.195, height: 0.0179 } },

    { label: 'Registered Address', val: '2 ANY HOUSE', b: { x: 0.195, y: 0.2643, width: 0.245, height: 0.0175 } },
    { label: 'Postcode', val: 'BT71 8BX', b: { x: 0.525, y: 0.2643, width: 0.160, height: 0.0180 } },
    { label: 'Responsible Adult', val: 'JOHNS MUM', b: { x: 0.565, y: 0.2820, width: 0.320, height: 0.0180 } },
    { label: 'Contact Number', val: '07727 847742', b: { x: 0.195, y: 0.3000, width: 0.245, height: 0.0180 } },

    { label: 'Child Status: Daycare', val: 'true', type: 'checkbox', b: { x: 0.196, y: 0.3355, width: 0.078, height: 0.0180 } },

    { label: 'Incident Date', val: '01.16.24', b: { x: 0.108, y: 0.3895, width: 0.084, height: 0.0185 } },
    { label: 'Incident Time', val: '4:PM', b: { x: 0.276, y: 0.3895, width: 0.085, height: 0.0185 } },
    { label: 'Space Room', val: 'ROOM 1', b: { x: 0.410, y: 0.3895, width: 0.270, height: 0.0185 } },

    { label: 'Incident Type: Accident', val: 'true', type: 'checkbox', b: { x: 0.196, y: 0.4080, width: 0.078, height: 0.0178 } },
    { label: 'Major Injury', val: 'true', type: 'checkbox', b: { x: 0.276, y: 0.4958, width: 0.085, height: 0.0179 } },
    { label: 'Cause: Contact with Peer', val: 'true', type: 'checkbox', b: { x: 0.276, y: 0.5303, width: 0.085, height: 0.0178 } },
    { label: 'Type of Injury: Abrasion / Cut', val: 'true', type: 'checkbox', b: { x: 0.362, y: 0.6015, width: 0.080, height: 0.0179 } },
    { label: 'Outcome: Return to Activities', val: 'true', type: 'checkbox', b: { x: 0.276, y: 0.7084, width: 0.085, height: 0.0178 } },

    {
      label: 'Incident Narrative Description',
      val: 'WASNT LOOKING WHERE HE WAS GOING RAN INTO JAMES\nSCRATCHED ARM - TLC - PLASTER WENT BACK TO GROUP',
      type: 'narrative',
      b: { x: 0.050, y: 0.7625, width: 0.830, height: 0.0450 }
    },

    { label: 'Form Completed By', val: 'AB NEGATIVE', b: { x: 0.180, y: 0.8220, width: 0.250, height: 0.0155 } },
    { label: 'Position', val: 'LEADER', b: { x: 0.540, y: 0.8220, width: 0.340, height: 0.0155 } },
    { label: 'Signed', val: 'A. McIntyre', b: { x: 0.150, y: 0.8373, width: 0.280, height: 0.0155 } },
    { label: 'Date Signed', val: '17-02-74', b: { x: 0.518, y: 0.8373, width: 0.350, height: 0.0155 } }
  ];

  // 1. Wipe ink inside boxes
  for (const f of fields) {
    if (f.type === 'narrative') {
      // Line 1: start at 0.125 to protect NARRATIVE label
      const l1X = Math.floor(0.125 * w) + 2;
      const l1Y = Math.floor(f.b.y * h) + 2;
      const l1W = Math.ceil(0.755 * w) - 4;
      const l1H = Math.ceil(0.0175 * h) - 3;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(l1X, l1Y, l1W, l1H);

      // Line 2: start at 0.050 to wipe full width
      const l2X = Math.floor(0.050 * w) + 2;
      const l2Y = Math.floor((f.b.y + 0.0175) * h) + 2;
      const l2W = Math.ceil(0.830 * w) - 4;
      const l2H = Math.ceil(0.0175 * h) - 3;
      ctx.fillRect(l2X, l2Y, l2W, l2H);
      continue;
    }

    const pxX = Math.floor(f.b.x * w) + 2;
    const pxY = Math.floor(f.b.y * h) + 2;
    const pxW = Math.ceil(f.b.width * w) - 4;
    const pxH = Math.ceil(f.b.height * h) - 4;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(pxX, pxY, pxW, pxH);
  }

  // 2. Render typed text
  for (const f of fields) {
    const pxX = Math.floor(f.b.x * w) + 6;
    const pxY = Math.floor(f.b.y * h);
    const pxW = Math.ceil(f.b.width * w) - 8;
    const pxH = Math.ceil(f.b.height * h);

    if (f.type === 'checkbox') {
      ctx.fillStyle = '#1e3a8a';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('X', pxX + pxW / 2, pxY + pxH / 2);
    } else if (f.type === 'narrative') {
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const lines = f.val.split('\n');
      // Line 1: after NARRATIVE label
      ctx.fillText(lines[0], Math.floor(0.128 * w), Math.floor((f.b.y + 0.0088) * h));
      // Line 2: full left indent
      ctx.fillText(lines[1], Math.floor(0.055 * w), Math.floor((f.b.y + 0.0263) * h));
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.val, pxX, pxY + pxH / 2);
    }
  }

  fs.writeFileSync('test_perfect_preview.png', canvas.toBuffer('image/png'));
  console.log('Saved test_perfect_preview.png successfully!');
}

testPerfectAlignment().catch(console.error);
