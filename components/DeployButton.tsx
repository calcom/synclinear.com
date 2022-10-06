import { CheckIcon, DoubleArrowUpIcon } from "@radix-ui/react-icons";
import React from "react";

interface IProps {
    loading: boolean;
    deployed: boolean;
    onDeploy: () => void;
}

const DeployButton = ({ loading, deployed, onDeploy }: IProps) => {
    return (
        <button
            onClick={onDeploy}
            disabled={deployed || loading}
            className={`${loading ? "animate-pulse" : ""}`}
        >
            {deployed ? (
                <>
                    <span>Deployed</span>
                    <CheckIcon className="w-6 h-6" />
                </>
            ) : (
                <>
                    <span>Deploy webhook</span>
                    <DoubleArrowUpIcon className="w-6 h-6" />
                </>
            )}
        </button>
    );
};

export default DeployButton;
