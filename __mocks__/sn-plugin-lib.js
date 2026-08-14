// Jest mock for the native plugin lib so pure logic (geometry/detect/cache
// storage) can be unit-tested in Node. Only the symbols the tested modules
// import need to exist.
module.exports = {
  PointUtils: {
    emrPoint2Android: (p) => ({ x: p.x, y: p.y }),
  },
  PluginFileAPI: {
    getElements: async () => ({ success: false, error: { message: 'mocked' } }),
    getElementNumList: async () => ({ success: false, error: { message: 'mocked' } }),
  },
};
