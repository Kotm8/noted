use std::{fs, path::Path};

fn add_directory(archive: &mut tar::Builder<fs::File>, root: &Path, path: &Path) {
    let mut entries: Vec<_> = fs::read_dir(path)
        .unwrap()
        .map(|item| item.unwrap().path())
        .collect();
    entries.sort();
    for entry in entries {
        if entry.is_dir() && entry.file_name().unwrap() != "__pycache__" {
            add_directory(archive, root, &entry);
        } else if entry.is_file()
            && matches!(
                entry.extension().and_then(|ext| ext.to_str()),
                Some("py" | "sh")
            )
        {
            println!("cargo:rerun-if-changed={}", entry.display());
            archive
                .append_path_with_name(
                    &entry,
                    Path::new("updater/code/noted_updater").join(entry.strip_prefix(root).unwrap()),
                )
                .unwrap();
        }
    }
}

fn main() {
    let root = Path::new("../../../updater/noted_updater");
    println!("cargo:rerun-if-changed={}", root.display());
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let mut archive = tar::Builder::new(fs::File::create(output.join("installer.tar")).unwrap());
    add_directory(&mut archive, root, root);
    archive.finish().unwrap();
    tauri_build::build()
}
