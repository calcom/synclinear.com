import React from "react";

interface IProps {
    direction: "left" | "right";
    active: boolean;
}

const SyncArrow = ({ direction, active }: IProps) => {
    return (
        <div
            className={`flex w-full items-center ${
                direction === "right" ? "rotate-180" : ""
            }`}
        >
            <div
                className={`w-4 h-4 border-l-4 border-b-4 rotate-45 ${
                    active ? "border-green-600" : "border-gray-400"
                }`}
            />
            <div
                className={`grow h-1 -translate-x-4 ${
                    active ? "bg-green-600" : "bg-gray-400"
                }`}
            />
        </div>
    );
};

export default SyncArrow;

