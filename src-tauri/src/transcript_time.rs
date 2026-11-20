pub(crate) fn js_space(c: char) -> bool {
    c.is_whitespace() && c != '\u{85}' || c == '\u{feff}'
}

pub(crate) fn parse_timestamp(value: &str) -> Option<u32> {
    let value = value.trim_matches(js_space);
    let digits =
        |s: &str, min, max| (min..=max).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit());
    let (clock, fraction) = value.split_once(['.', ',']).unwrap_or((value, ""));
    let milliseconds = if clock.len() == value.len() {
        0
    } else {
        if !digits(fraction, 1, 3) {
            return None;
        }
        fraction.parse::<u32>().ok()? * 10_u32.pow(3 - fraction.len() as u32)
    };
    let (leading, seconds) = clock.rsplit_once(':')?;
    let (hours, minutes) = leading.split_once(':').unwrap_or(("0", leading));
    if !digits(hours, 1, 2) || !digits(minutes, 2, 2) || !digits(seconds, 2, 2) {
        return None;
    }
    Some(
        ((hours.parse::<u32>().ok()? * 60 + minutes.parse::<u32>().ok()?) * 60
            + seconds.parse::<u32>().ok()?)
            * 1000
            + milliseconds,
    )
}
