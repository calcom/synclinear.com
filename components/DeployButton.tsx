import {
    CheckIcon,
    DotsHorizontalIcon,
    DoubleArrowUpIcon
} from "@radix-ui/react-icons";
import React from "react";

interface IProps {
    loading: boolean;
    deployed: boolean;
    disabled?: boolean;
    onDeploy: () => void;
}

const DeployButton = ({
    loading,
    deployed,
    disabled = false,
    onDeploy
}: IProps) => {
    return (
        <button
            onClick={onDeploy}
            disabled={disabled || deployed || loading}
            className={`primary ${loading ? "animate-pulse" : ""}`}
            aria-label="Deploy webhook"
        >
            {deployed ? (
                <>
                    <span>Deployed</span>
                    <CheckIcon className="w-6 h-6" />
                </>
            ) : loading ? (
                <>
                    <span>Loading</span>
                    <DotsHorizontalIcon className="w-6 h-6" />
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
