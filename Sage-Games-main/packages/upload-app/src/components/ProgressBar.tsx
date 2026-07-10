type Props = {
  currentProgressPercent: number; // a negative number will turn the progress bar red
};

export const ProgressBar = ({ ...props }: Props) => {
  const barColor =
    props.currentProgressPercent < 0 ? "bg-danger" : props.currentProgressPercent == 100 ? "bg-success" : "progress-bar-animated";
  return (
    <div className="text-center mx-auto">
      <p>Upload Progress... {Math.abs(props.currentProgressPercent)}%</p>
      <div className="progress">
        {/* loaded */}
        <div
          className={`progress-bar progress-bar-striped ${barColor}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.abs(props.currentProgressPercent)}
          style={{ width: `${Math.abs(props.currentProgressPercent)}%` }}
        ></div>
      </div>
    </div>
  );
};
