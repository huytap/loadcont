# Load Container 3D — MVP

Prototype web app for visualizing carton loading into a 40HC container.

## Features
- Three.js 3D container
- Orbit / zoom camera
- Sample products
- AUTO LOAD prototype
- Add one carton
- Product filter
- Carton selection
- CBM, weight and volume utilization

## Run
Requires Node.js 20+.

```bash
npm install
npm run dev
```

Then open the Vite URL shown in Terminal.

## Next steps
1. Replace sample products with ERP API.
2. Implement real 3D bin-packing constraints.
3. Add pallet support.
4. Add drag/drop and rotate carton.
5. Save/load plans in SQL Server.
6. Export loading plan to PDF/Excel.
