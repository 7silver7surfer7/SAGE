import React from "react";
import { CheckCircleIcon, ExclamationIcon } from "@heroicons/react/outline";
import { Oval } from "react-loader-spinner";

export enum TaskStatus {
  RUNNING,
  FINISHED,
  ERROR
}

type Props = {
  icon: JSX.Element,
  toastMsg: string,
  status: TaskStatus,
}

export const ToastContent = ({...props}: Props) => {
  const iconStyle = { width: "23px" };
  const styledIcon = React.cloneElement(props.icon, { style: iconStyle });
  return (
    <div className="d-flex justify-content-between align-items-center">
      <div>{styledIcon}</div>
      <div className="mx-2 w-100">{props.toastMsg}</div>
      <div>
        {props.status == TaskStatus.RUNNING && <Oval color="black" width="21px" height="21px" />}
        {props.status == TaskStatus.FINISHED && <CheckCircleIcon style={iconStyle} />}
        {props.status == TaskStatus.ERROR && <ExclamationIcon stroke="red" style={iconStyle} />}
      </div>
    </div>
  );
}