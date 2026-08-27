const fs = require('fs');
const file = 'src/routes/projectRoutes.ts';
let content = fs.readFileSync(file, 'utf8');

const routeStr = `// Reserve material for project`;
const deleteRoute = `
// Delete reserved material for project
router.delete('/:id/materials/:materialId', authenticate, async (req, res) => {
  try {
    const { id, materialId } = req.params;
    
    const projectMaterial = await prisma.projectMaterial.findUnique({
      where: { id: materialId },
      include: { inventory: true }
    });

    if (!projectMaterial || projectMaterial.projectId !== id) {
      return res.status(404).json({ message: 'Reserved material not found' });
    }

    // Add quantity back to inventory and delete project material
    await prisma.$transaction([
      prisma.inventory.update({
        where: { id: projectMaterial.inventoryId },
        data: { quantity: { increment: projectMaterial.quantity } }
      }),
      prisma.projectMaterial.delete({
        where: { id: materialId }
      })
    ]);

    // If it was a client material, we might also want to delete it from inventory completely if quantity goes back to full. But incrementing is safe enough.

    res.json({ message: 'Material un-reserved successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting reserved material' });
  }
});

`;

content = content.replace(routeStr, deleteRoute + routeStr);
fs.writeFileSync(file, content);
console.log('patched');
