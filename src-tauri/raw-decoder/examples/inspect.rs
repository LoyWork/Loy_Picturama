//! Write the exact display pixels to a JPEG for camera compatibility/colour checks.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let input = args.get(1).ok_or("usage: inspect INPUT.raw OUTPUT.jpg [--preview]")?;
    let output = args.get(2).ok_or("usage: inspect INPUT.raw OUTPUT.jpg [--preview]")?;
    let image = picturama_raw::decode_file(input, args.iter().any(|a| a == "--preview"))?;
    let file = std::fs::File::create(output)?;
    image::codecs::jpeg::JpegEncoder::new_with_quality(file, 95)
        .encode(&image.data, image.width, image.height, image::ExtendedColorType::Rgb8)?;
    println!("{}x{}, preview: {:?}", image.width, image.height, image.preview_reason);
    Ok(())
}
