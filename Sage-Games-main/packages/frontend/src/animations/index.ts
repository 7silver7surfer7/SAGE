const variants = {
  pageInitial: { opacity: 0 },
  pageAnimate: {
    opacity: 1,
  },
  default: {},
  stagger: {
    transition: {
      delayChildren: 5,
      staggerChildren: 1,
    },
  },
};

export default variants;
