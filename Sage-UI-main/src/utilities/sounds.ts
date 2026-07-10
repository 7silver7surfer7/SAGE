function playSoundFile(fileUrl: string, volume?: number) {
  try {
    const audio = new Audio(fileUrl);
    if (volume) {
      audio.volume = volume;
    }
    audio.play();
  } catch (e) {
    // ignore
  }
}

export function playErrorSound() {
  playSoundFile('/sounds/error.wav');
}

export function playWalletConnectedSound() {
  playSoundFile('/sounds/chime.mp3');
}

export function playLikeDropSound() {
  playSoundFile('/sounds/like.wav');
}

export function playUnlikeDropSound() {
  playSoundFile('/sounds/unlike.wav');
}

export function playTxSuccessSound() {
  playSoundFile('/sounds/ticket.wav');
}

export function playPrizeClaimedSound() {
  playSoundFile('/sounds/prize.wav', 0.7);
}
