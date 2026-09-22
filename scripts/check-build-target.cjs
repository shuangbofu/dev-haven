module.exports = async context => {
  const names = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
  const arch = names[context.arch];
  if (context.electronPlatformName !== process.platform || arch !== process.arch) {
    throw new Error(`原生终端模块需要在目标系统/架构构建：当前 ${process.platform}-${process.arch}，目标 ${context.electronPlatformName}-${arch}。请在对应主机执行 npm ci 与 npm run dist。`);
  }
};
