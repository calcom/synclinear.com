import React from "react";

interface IProps {
    direction: "left" | "right";
    active: boolean;
}

const SyncArrow = ({ direction, active }: IProps) => {
    return (
        <div
            className={`center sm:flex-row h-full sm:w-full ${
                direction === "right" ? "rotate-180" : ""
            }`}
        >
            <div
                className={`w-4 h-4 border-l-4 border-b-4 rotate-[135deg] sm:rotate-45 translate-y-2 sm:translate-y-0 sm:translate-x-2 ${
                    active ? "border-green-600" : "border-gray-400"
                }`}
            />
            <div
                className={`grow w-1 sm:h-1 -translate-y-2 sm:translate-y-0 sm:-translate-x-2 ${
                    active ? "bg-green-600" : "bg-gray-400"
                }`}
            />
        </div>
    );
};

export default SyncArrow;

