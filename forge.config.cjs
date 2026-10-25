module.exports = {
  packagerConfig: {
    asar: { unpack: '**/*.node' }, executableName: 'Sargosh', icon: 'assets/sargosh',
    ignore: [/^\/work($|\/)/, /^\/\.local($|\/)/, /^\/\.env/, /^\/tests($|\/)/, /^\/src($|\/)/, /^\/helper($|\/)/, /^\/\.git($|\/)/],
    extraResource: ['assets']
  },
  makers: [{ name: '@electron-forge/maker-squirrel', config: { name: 'Sargosh', setupIcon: 'assets/sargosh.ico' } }]
};
