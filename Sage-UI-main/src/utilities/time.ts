type duration = number;
type time = number | string;

export function msToTime(duration: duration) {
  var seconds: time = Math.floor((duration / 1000) % 60),
    minutes: time = Math.floor((duration / (1000 * 60)) % 60),
    hours: time = Math.floor((duration / (1000 * 60 * 60)) % 24);

  hours = hours < 10 ? '0' + hours : hours;
  minutes = minutes < 10 ? '0' + minutes : minutes;
  seconds = seconds < 10 ? '0' + seconds : seconds;

  return hours + ':' + minutes + ':' + seconds;
}
