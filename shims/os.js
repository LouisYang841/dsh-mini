// node:os shim.
export function homedir() {
	return "/home/ubuntu";
}
export function tmpdir() {
	return "/tmp";
}
export function platform() {
	return "linux";
}
export function arch() {
	return "x64";
}
export function hostname() {
	return "spike-host";
}
export function cpus() {
	return [];
}
export function totalmem() {
	return 0;
}
export function freemem() {
	return 0;
}
export const EOL = "\n";
export default { homedir, tmpdir, platform, arch, hostname, cpus, totalmem, freemem, EOL };
